output "app_public_ip" {
  value = aws_eip.app.public_ip
}

output "app_url" {
  value = "http://${aws_eip.app.public_ip}"
}

output "ssh_command" {
  value = "ssh -i infra/${local.name}.pem ec2-user@${aws_eip.app.public_ip}"
}

output "private_key_path" {
  value = local_sensitive_file.private_key.filename
}

output "seed_admin_email" {
  value = var.seed_admin_email
}

output "seed_admin_password" {
  value     = random_password.seed_admin.result
  sensitive = true
}

output "db_password" {
  value     = random_password.db.result
  sensitive = true
}

output "app_secret" {
  value     = random_password.app_secret.result
  sensitive = true
}
