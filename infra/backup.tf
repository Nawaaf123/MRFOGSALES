# Daily EBS snapshots (DLM) + S3 bucket for Postgres dumps.

resource "aws_s3_bucket" "db_backups" {
  bucket = "${local.name}-db-backups-${local.account_id}"
  tags   = { Name = "${local.name}-db-backups" }
}

resource "aws_s3_bucket_public_access_block" "db_backups" {
  bucket                  = aws_s3_bucket.db_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    id     = "expire-postgres-dumps-30d"
    status = "Enabled"

    filter {
      prefix = "postgres/"
    }

    expiration {
      days = 30
    }
  }
}

resource "aws_iam_role" "app" {
  name = "${local.name}-ec2"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "app_backup" {
  name = "db-backups"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [aws_s3_bucket.db_backups.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = ["${aws_s3_bucket.db_backups.arn}/*"]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "app" {
  name = "${local.name}-ec2"
  role = aws_iam_role.app.name
}

resource "aws_iam_role" "dlm" {
  name = "${local.name}-dlm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "ebs_daily" {
  description        = "${local.name} daily EBS volume snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]

    target_tags = {
      Backup = "true"
    }

    schedule {
      name = "daily"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["07:00"] # UTC (~2–3am US Eastern depending on DST)
      }

      retain_rule {
        count = 7
      }

      copy_tags = true
    }
  }

  tags = { Name = "${local.name}-ebs-daily" }
}
