# Changelog

All notable changes to the Kiro Metrics Exporter extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-01-04

### Added

- Operation logging with daily log files
- Log file viewer commands (Open Log File, Open Log Folder)
- Detailed upload progress logging with timing statistics
- Version info display at top of TreeView panel
- Open Settings command in Step 4
- Step 4: Logs & Settings section in TreeView
- **Activity Bar Icon**: Dedicated sidebar icon for Metrics Exporter
- **Step-by-Step Configuration**: 4-step organized configuration panel
  - Step 1: AWS Credentials
  - Step 2: User Identity
  - Step 3: S3 Configuration
  - Step 4: Logs & Settings
- **Username Resolution**: Automatic User ID and Display Name resolution
  - New `username` configuration field
  - New `displayName` configuration field (auto-resolved)
  - `Resolve User ID & Display Name` button
  - Auto-resolve on username change in Settings
- **S3 Permission Check**: Pre-upload permission verification
  - `Check S3 Write Permission` button
  - Detailed error messages for common issues
- **Settings Page Improvements**:
  - Configuration items ordered by step
  - Step prefix labels (`[Step 1]`, `[Step 2]`, `[Step 3]`)
  - Clickable links for resolve and permission check
- **Logger Module**: Operation logging to local files
  - Log location: `~/.kiro-metrics-exporter/logs/`
  - Daily log files: `metrics-exporter-YYYY-MM-DD.log`
- Configuration change listener for auto-resolve
- Clickable links in Settings markdown descriptions
- Settings page configuration ordering
- Display Name resolution via DescribeUser API
- S3 permission check functionality
- Three-step configuration panel structure
- Username field separate from User ID

### Changed

- TreeView reorganized into steps
- Log format includes timestamps, log levels, and context
- TreeView now has 4 steps instead of 3
- Panel moved from Explorer sidebar to dedicated Activity Bar
- User ID is now auto-resolved instead of manual input
- Upload confirmation dialog for "Upload All" operation

### Fixed

- Minor UI improvements
- Auto-resolve debounce timing
- Error message clarity improvements

## [1.0.0] - 2024-12-24

### Added

- Basic metrics collection from Kiro agent directory
- S3 upload functionality
- Time-filtered exports (Last 7 Days, All Till Yesterday)
- AWS Identity Store integration for user lookup
- Configuration panel in Explorer sidebar
