output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "worker_url" { value = google_cloud_run_v2_service.worker.uri }
output "quarantine_bucket" { value = google_storage_bucket.quarantine.name }
output "invoice_bucket" { value = google_storage_bucket.invoices.name }
output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
