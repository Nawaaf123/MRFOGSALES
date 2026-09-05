variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "project_name" {
  type    = string
  default = "mrfogsales"
}

variable "instance_type" {
  type    = string
  default = "t3.medium"
}

variable "seed_admin_email" {
  type    = string
  default = "admin@example.com"
}

variable "allowed_ssh_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Restrict SSH (e.g. your.home.ip/32). Default open — tighten after first deploy."
}
