FROM python:3.12.12-slim-bookworm@sha256:593bd06efe90efa80dc4eee3948be7c0fde4134606dd40d8dd8dbcade98e669c
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr=5.3.0-2 tesseract-ocr-eng=1:4.1.0-2 tesseract-ocr-hin=1:4.1.0-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt
COPY app ./app
RUN useradd --system --uid 10001 challanse && chown -R challanse:challanse /app
USER 10001
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
