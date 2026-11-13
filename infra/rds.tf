# Managed PostgreSQL for the app. Private: only the app server's security group can connect.

variable "rds_instance_class" {
  type        = string
  default     = "db.t4g.micro"
  description = "RDS size. db.t4g.micro (2 vCPU burst, 1 GB) fits the current ~15 MB database."
}

variable "rds_multi_az" {
  type        = bool
  default     = false
  description = "Keep a standby copy in a second availability zone (roughly doubles RDS cost)."
}

# RDS requires subnets in at least two availability zones, even for a single instance.
resource "aws_subnet" "db_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.50.11.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]
  tags              = { Name = "${local.name}-db-a" }
}

resource "aws_subnet" "db_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.50.12.0/24"
  availability_zone = data.aws_availability_zones.available.names[1]
  tags              = { Name = "${local.name}-db-b" }
}

resource "aws_db_subnet_group" "app" {
  name       = "${local.name}-db"
  subnet_ids = [aws_subnet.db_a.id, aws_subnet.db_b.id]
  tags       = { Name = "${local.name}-db" }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-rds-sg"
  description = "Postgres from the ${local.name} app server only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from app server"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = { Name = "${local.name}-rds-sg" }
}

resource "aws_db_instance" "app" {
  identifier     = "${local.name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.rds_instance_class

  db_name  = "concept_foundry"
  username = "mrfog"
  password = random_password.db.result
  port     = 5432

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.app.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = var.rds_multi_az

  # Point-in-time restore to any minute in the last 7 days.
  backup_retention_period = 7
  backup_window           = "07:30-08:00"         # UTC, ~1:30-2:00 AM Central
  maintenance_window      = "sun:09:00-sun:09:30" # UTC, ~3:00-3:30 AM Central Sunday

  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true
  deletion_protection        = true
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-db-final"
  apply_immediately          = false

  tags = { Name = "${local.name}-db" }

  lifecycle {
    prevent_destroy = true
  }
}

output "rds_address" {
  value       = aws_db_instance.app.address
  description = "Private RDS hostname for DATABASE_URL."
}

output "rds_port" {
  value = aws_db_instance.app.port
}
