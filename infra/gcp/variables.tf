variable "project_id" { type = string }
variable "billing_account_id" {
  type      = string
  sensitive = true
}
variable "base_monthly_budget_inr" {
  type    = number
  default = 1000
}
variable "environment" {
  type = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production"
  }
}
variable "region" {
  type    = string
  default = "asia-south1"
}
variable "container_image" {
  type        = string
  description = "Immutable Artifact Registry image digest."
  default     = ""
  validation {
    condition     = var.container_image == "" || can(regex("@sha256:[a-f0-9]{64}$", var.container_image))
    error_message = "container_image must be empty for bootstrap or use an immutable sha256 digest"
  }
}
variable "bootstrap_only" {
  type        = bool
  default     = false
  description = "Create shared platform resources without Cloud Run application services."
}
variable "billing_enabled" {
  type        = bool
  default     = false
  description = "Attach Razorpay secret versions only after KYC and secret provisioning pass."
}
variable "global_daily_limit" {
  type    = number
  default = 550
  validation {
    condition     = var.global_daily_limit > 0 && var.global_daily_limit <= 550
    error_message = "daily limit cannot exceed the approved launch cap"
  }
}
variable "app_origin" {
  type        = string
  description = "Exact Firebase Hosting origin, without trailing slash."
  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.app_origin))
    error_message = "app_origin must be one HTTPS origin"
  }
}
