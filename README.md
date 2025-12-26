# Kiro Metrics Exporter

[![Open VSX Version](https://img.shields.io/open-vsx/v/DiscreteTom/kiro-metrics-exporter)](https://open-vsx.org/extension/DiscreteTom/kiro-metrics-exporter)

A VSCode extension that exports Kiro IDE usage metrics to AWS S3.

## Features

- **Configuration Panel**: Left sidebar panel for AWS configuration management
- **Metrics Collection**: Scans Kiro agent directory and extracts usage metrics
- **S3 Upload**: Uploads metrics data to AWS S3 in CSV format
- **Time-filtered Exports**: Upload metrics for last 7 days or last 30 days
- **AWS Identity Store Integration**: Resolves user IDs from usernames

## Setup

1. Install the extension
2. Open the "Metrics Exporter" panel in the Explorer sidebar
3. Configure your AWS settings by clicking on each item:
   - **Access Key**: Your AWS Access Key ID
   - **Secret Key**: Your AWS Secret Access Key
   - **S3 Prefix**: Full S3 path (e.g., `s3://bucket/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/`)
   - **S3 Region**: AWS region for S3 operations (e.g., `us-east-1`)
   - **Identity Store Region**: AWS region for Identity Store operations (e.g., `us-east-1`)
   - **Identity Store ID**: Your AWS Identity Store ID
   - **User ID**: Set by entering your username (automatically resolved via Identity Store)

## Usage

### Export Metrics

Use the buttons in the panel header:

- **Upload Last 7 Days**: Export metrics for the past week (T-7 to T-1)
- **Upload All Till Yesterday**: Export all available metrics data up to yesterday (T-1)

### CSV Output Format

The extension generates CSV files with the following schema:

- `UserId`: AWS Identity Center User ID
- `Date`: Date in MM-DD-YYYY format
- `Chat_AICodeLines`: Net lines of AI-generated code
- `Chat_MessagesSent`: Number of executions/messages sent
- Other columns set to 0 (for compatibility with existing analytics)

### S3 Path Structure

Files are uploaded following this pattern:

```
s3://bucket/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/year/month/day/00/kiro-ide-{userid}.csv
```

**Note**: Uploads are idempotent - the same file path is used for each date/user combination, so repeated uploads will overwrite the previous file with the same data.

## Requirements

- AWS credentials with permissions for:
  - S3: `PutObject` access to the target bucket
  - Identity Store: `GetUserId` access to resolve usernames
- Kiro IDE with agent activity data in the platform-specific directory:
  - Windows: `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent`
  - macOS: `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent`
  - Linux: `~/.config/Kiro/User/globalStorage/kiro.kiroagent`

## Development

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Watch for changes
npm run watch
```

## Testing

1. Press `F5` to open a new Extension Development Host window
2. The extension will be loaded automatically
3. Look for "Metrics Exporter" in the Explorer sidebar
4. Configure AWS settings and test the export functionality
