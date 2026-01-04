# Changelog

All notable changes to the Kiro Metrics Exporter extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.4] - 2025-01-04

### Added
- Operation logging with daily log files
- Log file viewer commands (Open Log File, Open Log Folder)
- Detailed upload progress logging with timing statistics

### Changed
- Log format includes timestamps, log levels, and context

## [1.1.3] - 2025-01-03

### Added
- Version info display at top of TreeView panel
- Open Settings command in Step 4

### Fixed
- Minor UI improvements

## [1.1.2] - 2025-01-02

### Added
- Step 4: Logs & Settings section in TreeView

### Changed
- TreeView now has 4 steps instead of 3

## [1.1.1] - 2025-01-01

### Fixed
- Auto-resolve debounce timing
- Error message clarity improvements

## [1.1.0] - 2024-12-31

### Added
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

### Changed
- Panel moved from Explorer sidebar to dedicated Activity Bar
- User ID is now auto-resolved instead of manual input
- Upload confirmation dialog for "Upload All" operation

## [1.0.6] - 2024-12-30

### Added
- Configuration change listener for auto-resolve

## [1.0.5] - 2024-12-29

### Added
- Clickable links in Settings markdown descriptions

## [1.0.4] - 2024-12-28

### Added
- Settings page configuration ordering

## [1.0.3] - 2024-12-27

### Added
- Display Name resolution via DescribeUser API

## [1.0.2] - 2024-12-26

### Added
- S3 permission check functionality

## [1.0.1] - 2024-12-25

### Added
- Three-step configuration panel structure
- Username field separate from User ID

### Changed
- TreeView reorganized into steps

## [1.0.0] - 2024-12-24

### Added
- Initial release by DiscreteTom
- Basic metrics collection from Kiro agent directory
- S3 upload functionality
- Time-filtered exports (Last 7 Days, All Till Yesterday)
- AWS Identity Store integration for user lookup
- Configuration panel in Explorer sidebar
