import logging
import signal
import threading
import time

from .config import get_settings
from .local_health import record_ollama_health
from .local_test_runs import claim_test_run, prune_test_runs, recover_interrupted_test_runs, run_claimed_test
from .observability import configure_observability
from .outbox import dispatch_outbox_once
from .queueing import claim_local_message, complete_local_message, fail_local_message
from .workflow import process_receipt_event


logger = logging.getLogger("challanse.enrichment.local_worker")
stopping = threading.Event()


def _stop(_signal_number, _frame) -> None:
    stopping.set()


def run_worker() -> None:
    settings = get_settings()
    configure_observability(settings)
    if settings.event_queue_provider != "postgres":
        raise RuntimeError("local_worker_requires_postgres_queue")
    database_url = settings.system_database_url or settings.database_url
    if not database_url:
        raise RuntimeError("database_url_unconfigured")
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    recovered = recover_interrupted_test_runs(settings)
    if recovered:
        logger.warning("local_test_runs_recovered", extra={"count": recovered})
    next_health_check = 0.0
    test_thread: threading.Thread | None = None
    while not stopping.is_set():
        now = time.monotonic()
        if now >= next_health_check:
            try:
                record_ollama_health(settings)
                prune_test_runs(settings)
            except Exception as error:
                logger.warning("local_ollama_health_record_failed", extra={"error_code": type(error).__name__})
            next_health_check = now + 15.0
        if test_thread is None or not test_thread.is_alive():
            test_run_id = claim_test_run(settings)
            if test_run_id:
                test_thread = threading.Thread(
                    target=run_claimed_test,
                    args=(settings, test_run_id),
                    name=f"local-test-{test_run_id}",
                    daemon=True,
                )
                test_thread.start()
        dispatch_outbox_once(settings)
        message = claim_local_message(database_url)
        if message is None:
            stopping.wait(1.0)
            continue
        try:
            process_receipt_event(settings, message.event)
            complete_local_message(database_url, message)
            dispatch_outbox_once(settings)
        except Exception as error:
            logger.error(
                "local_receipt_processing_failed",
                extra={"error_code": type(error).__name__, "receipt_id": message.event.receipt_id},
            )
            fail_local_message(database_url, message, type(error).__name__)
        time.sleep(0.1)


if __name__ == "__main__":
    run_worker()
