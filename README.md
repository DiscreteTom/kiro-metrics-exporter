# Kiro Metrics Exporter

A VSCode extension that exports directory metrics to AWS S3.

## Features

- **Configuration Panel**: Left sidebar panel for AWS credentials management
- **Directory Scanning**: Scans workspace directories and extracts metrics
- **S3 Upload**: Uploads metrics data to AWS S3 (currently mock implementation)
- **Test File Upload**: Upload any local file to S3 for testing credentials and connectivity

## Setup

1. Install the extension
2. Open the "Metrics Exporter" panel in the Explorer sidebar
3. Configure your AWS credentials:
   - Click on "Access Key" to set your AWS Access Key
   - Click on "Secret Key" to set your AWS Secret Key
4. Test your setup:
   - Click the file upload button (📤) to test uploading a specific file
   - Click the cloud upload button (☁️) to export metrics

## Using the Test Upload Feature

The test upload feature allows you to upload any local file to S3:

1. **Click the Test Upload button** (📤) in the panel header
2. **Enter local file path**: 
   - Absolute path: `C:\path\to\file.txt`
   - Relative to workspace: `./README.md` or `src/file.js`
3. **Enter S3 destination**: 
   - Format: `bucket-name/folder/filename.ext`
   - Example: `my-test-bucket/uploads/test-file.txt`
4. **File will be uploaded** with proper content type and metadata

The extension will:
- ✅ Validate file exists locally
- ✅ Read file content and size
- ✅ Determine appropriate content type
- ✅ Upload to S3 with metadata (original path, upload time, file size)
- ✅ Show detailed success/error messages

## Setup

1. Install the extension
2. Open the "Metrics Exporter" panel in the Explorer sidebar
3. Configure your AWS credentials:
   - Click on "Access Key" to set your AWS Access Key
   - Click on "Secret Key" to set your AWS Secret Key
4. Click the cloud upload button to export metrics

## Current Implementation

This is a basic implementation with:
- ✅ VSCode extension structure
- ✅ Left sidebar configuration panel
- ✅ AWS credential input fields
- ✅ Mock directory scanning
- ✅ Mock S3 upload functionality
- ✅ **NEW**: Real S3 file upload testing functionality

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
4. Test the configuration and export functionality

## Next Steps

- Implement actual S3 upload functionality
- Add configurable S3 bucket and region settings
- Enhance metrics collection with more detailed analysis
- Add error handling and validation
- Implement proper credential encryption