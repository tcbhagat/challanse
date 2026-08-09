terraform {
  required_version = ">= 1.9.8, < 2.0.0"
  backend "gcs" {}
  required_providers {
    google = { source = "hashicorp/google", version = "~> 6.40" }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" { project_id = var.project_id }

locals {
  services = toset([
    "artifactregistry.googleapis.com", "billingbudgets.googleapis.com", "cloudbilling.googleapis.com",
    "cloudbuild.googleapis.com", "cloudscheduler.googleapis.com", "cloudtasks.googleapis.com",
    "firebase.googleapis.com", "firestore.googleapis.com", "iamcredentials.googleapis.com",
    "pubsub.googleapis.com", "run.googleapis.com", "secretmanager.googleapis.com", "storage.googleapis.com"
  ])
  labels = { application = "challanse", environment = var.environment, managed_by = "terraform" }
}

resource "google_project_service" "required" {
  for_each           = local.services
  service            = each.key
  disable_on_destroy = false
}

resource "google_pubsub_topic" "budget" {
  name       = "challanse-budget"
  labels     = local.labels
  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic_iam_member" "budget_publisher" {
  topic  = google_pubsub_topic.budget.name
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-billingbudgets.iam.gserviceaccount.com"
}

resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account_id
  display_name    = "ChallanSe ${var.environment} monthly ceiling"
  budget_filter { projects = ["projects/${data.google_project.current.number}"] }
  amount {
    specified_amount {
      currency_code = "INR"
      units         = tostring(var.base_monthly_budget_inr)
    }
  }
  threshold_rules { threshold_percent = 0.5 }
  threshold_rules { threshold_percent = 0.75 }
  threshold_rules { threshold_percent = 0.9 }
  threshold_rules { threshold_percent = 1.0 }
  all_updates_rule {
    pubsub_topic                   = google_pubsub_topic.budget.id
    schema_version                 = "1.0"
    disable_default_iam_recipients = false
  }
}

resource "google_firestore_database" "primary" {
  name            = "(default)"
  location_id     = var.region
  type            = "FIRESTORE_NATIVE"
  deletion_policy = "ABANDON"
  depends_on      = [google_project_service.required]
}

resource "google_storage_bucket" "quarantine" {
  name                        = "${var.project_id}-challanse-quarantine"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  cors {
    origin          = [var.app_origin]
    method          = ["PUT"]
    response_header = ["Content-Type", "ETag"]
    max_age_seconds = 600
  }
  lifecycle_rule {
    condition { age = 1 }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket" "invoices" {
  name                        = "${var.project_id}-challanse-invoices"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle_rule {
    condition { num_newer_versions = 1 }
    action { type = "Delete" }
  }
}

resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-challanse-backups"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false
  labels                      = local.labels
  versioning { enabled = true }
  lifecycle_rule {
    condition { age = 35 }
    action { type = "Delete" }
  }
}

resource "google_artifact_registry_repository" "containers" {
  location      = var.region
  repository_id = "challanse"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.required]
}

resource "google_service_account" "api" {
  account_id   = "challanse-api"
  display_name = "ChallanSe API"
}
resource "google_service_account" "worker" {
  account_id   = "challanse-worker"
  display_name = "ChallanSe OCR worker"
}
resource "google_service_account" "tasks" {
  account_id   = "challanse-tasks"
  display_name = "ChallanSe task dispatcher"
}

resource "google_project_iam_member" "api_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}
resource "google_project_iam_member" "worker_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_storage_bucket_iam_member" "api_quarantine" {
  bucket = google_storage_bucket.quarantine.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
resource "google_storage_bucket_iam_member" "api_invoices" {
  bucket = google_storage_bucket.invoices.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}
resource "google_storage_bucket_iam_member" "worker_invoices" {
  bucket = google_storage_bucket.invoices.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
}
resource "google_service_account_iam_member" "api_signing" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_tasks_queue" "ocr" {
  name     = "invoice-ocr"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 3
    max_dispatches_per_second = 2
  }
  retry_config {
    max_attempts       = 5
    max_retry_duration = "3600s"
    min_backoff        = "10s"
    max_backoff        = "300s"
    max_doublings      = 4
  }
  depends_on = [google_project_service.required]
}

resource "google_project_iam_member" "api_tasks" {
  project = var.project_id
  role    = "roles/cloudtasks.enqueuer"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "tasks_export" {
  project = var.project_id
  role    = "roles/datastore.importExportAdmin"
  member  = "serviceAccount:${google_service_account.tasks.email}"
}

resource "google_storage_bucket_iam_member" "tasks_backups" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.admin"
  member = "serviceAccount:${google_service_account.tasks.email}"
}

resource "google_secret_manager_secret" "razorpay_key_id" {
  secret_id = "challanse-razorpay-key-id"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "razorpay_key_secret" {
  secret_id = "challanse-razorpay-key-secret"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "razorpay_plan_id" {
  secret_id = "challanse-razorpay-plan-id"
  replication {
    auto {}
  }
}
resource "google_secret_manager_secret" "razorpay_webhook" {
  secret_id = "challanse-razorpay-webhook-secret"
  replication {
    auto {}
  }
}

locals {
  razorpay_secrets = toset([
    google_secret_manager_secret.razorpay_key_id.secret_id,
    google_secret_manager_secret.razorpay_key_secret.secret_id,
    google_secret_manager_secret.razorpay_plan_id.secret_id,
    google_secret_manager_secret.razorpay_webhook.secret_id
  ])
}

resource "google_secret_manager_secret_iam_member" "api_secret_access" {
  for_each  = local.razorpay_secrets
  project   = var.project_id
  secret_id = each.key
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service" "worker" {
  count               = var.bootstrap_only ? 0 : 1
  name                = "challanse-worker"
  location            = var.region
  deletion_protection = var.environment == "production"
  labels              = local.labels
  template {
    service_account                  = google_service_account.worker.email
    timeout                          = "120s"
    max_instance_request_concurrency = 1
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.container_image
      resources {
        limits            = { cpu = "1", memory = "1Gi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      env {
        name  = "CHALLANSE_environment"
        value = var.environment
      }
      env {
        name  = "CHALLANSE_service_role"
        value = "worker"
      }
      env {
        name  = "CHALLANSE_project_id"
        value = var.project_id
      }
      env {
        name  = "CHALLANSE_accepted_bucket"
        value = google_storage_bucket.invoices.name
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
      error_message = "Application deployment requires an immutable container image digest."
    }
  }
}

resource "google_cloud_run_v2_service" "api" {
  count               = var.bootstrap_only ? 0 : 1
  name                = "challanse-api"
  location            = var.region
  deletion_protection = var.environment == "production"
  labels              = local.labels
  template {
    service_account                  = google_service_account.api.email
    timeout                          = "60s"
    max_instance_request_concurrency = 40
    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
    containers {
      image = var.container_image
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        cpu_idle          = true
        startup_cpu_boost = false
      }
      env {
        name  = "CHALLANSE_environment"
        value = var.environment
      }
      env {
        name  = "CHALLANSE_service_role"
        value = "api"
      }
      env {
        name  = "CHALLANSE_project_id"
        value = var.project_id
      }
      env {
        name  = "CHALLANSE_upload_bucket"
        value = google_storage_bucket.quarantine.name
      }
      env {
        name  = "CHALLANSE_accepted_bucket"
        value = google_storage_bucket.invoices.name
      }
      env {
        name  = "CHALLANSE_task_worker_url"
        value = google_cloud_run_v2_service.worker[0].uri
      }
      env {
        name  = "CHALLANSE_task_service_account"
        value = google_service_account.tasks.email
      }
      env {
        name  = "CHALLANSE_global_daily_limit"
        value = tostring(var.global_daily_limit)
      }
      env {
        name  = "CHALLANSE_require_app_check"
        value = "true"
      }
      dynamic "env" {
        for_each = var.billing_enabled ? [1] : []
        content {
          name = "CHALLANSE_razorpay_key_id"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_key_id.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.billing_enabled ? [1] : []
        content {
          name = "CHALLANSE_razorpay_key_secret"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_key_secret.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.billing_enabled ? [1] : []
        content {
          name = "CHALLANSE_razorpay_plan_id"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_plan_id.secret_id
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.billing_enabled ? [1] : []
        content {
          name = "CHALLANSE_razorpay_webhook_secret"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.razorpay_webhook.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_service.required]
  lifecycle {
    precondition {
      condition     = can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
      error_message = "Application deployment requires an immutable container image digest."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  count    = var.bootstrap_only ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api[0].name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
resource "google_cloud_run_v2_service_iam_member" "tasks_worker" {
  count    = var.bootstrap_only ? 0 : 1
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.worker[0].name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks.email}"
}

resource "google_pubsub_subscription" "budget_control" {
  count                = var.bootstrap_only ? 0 : 1
  name                 = "challanse-budget-control"
  topic                = google_pubsub_topic.budget.name
  ack_deadline_seconds = 30
  push_config {
    push_endpoint = "${google_cloud_run_v2_service.worker[0].uri}/internal/tasks/budget"
    oidc_token {
      service_account_email = google_service_account.tasks.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }
  depends_on = [google_cloud_run_v2_service_iam_member.tasks_worker]
}

resource "google_cloud_scheduler_job" "retention" {
  count     = var.bootstrap_only ? 0 : 1
  name      = "challanse-retention"
  region    = var.region
  schedule  = "15 2 * * *"
  time_zone = "Asia/Kolkata"
  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.worker[0].uri}/internal/tasks/retention"
    headers     = { X-CloudScheduler = "true" }
    oidc_token {
      service_account_email = google_service_account.tasks.email
      audience              = google_cloud_run_v2_service.worker[0].uri
    }
  }
}

resource "google_cloud_scheduler_job" "firestore_backup" {
  name      = "challanse-firestore-backup"
  region    = var.region
  schedule  = "30 2 * * *"
  time_zone = "Asia/Kolkata"
  http_target {
    http_method = "POST"
    uri         = "https://firestore.googleapis.com/v1/projects/${var.project_id}/databases/(default):exportDocuments"
    body        = base64encode(jsonencode({ outputUriPrefix = "gs://${google_storage_bucket.backups.name}/firestore" }))
    headers     = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.tasks.email
      scope                 = "https://www.googleapis.com/auth/datastore"
    }
  }
  depends_on = [google_project_iam_member.tasks_export, google_storage_bucket_iam_member.tasks_backups]
}

resource "google_firestore_index" "invoice_history" {
  collection = "invoices"
  database   = google_firestore_database.primary.name
  fields {
    field_path = "uid"
    order      = "ASCENDING"
  }
  fields {
    field_path = "state"
    order      = "ASCENDING"
  }
  fields {
    field_path = "createdAt"
    order      = "DESCENDING"
  }
}
