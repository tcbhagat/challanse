output "api_url" { value = try(google_cloud_run_v2_service.api[0].uri, null) }
output "worker_url" { value = try(google_cloud_run_v2_service.worker[0].uri, null) }
output "quarantine_bucket" { value = google_storage_bucket.quarantine.name }
output "invoice_bucket" { value = google_storage_bucket.invoices.name }
output "artifact_repository" { value = google_artifact_registry_repository.containers.name }
