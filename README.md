# Page Change Monitor

## Description
Page Change Monitor is a browser extension that automatically monitors changes in a specific area of a web page. The extension detects visual changes in the selected area and alerts you when a significant change is detected.

## Key Features

- **Visual Area Selection**: Easily select the area of the page you want to monitor through an intuitive selection interface.
- **Automatic Monitoring**: Once the area is selected, the extension periodically reloads the page and checks for changes.
- **Notifications**: Receive audio and visual notifications when a change is detected in the monitored area.
- **Visual Comparison**: View a detailed comparison between the original image and the modified one when a change is detected.
- **Customization**: Set the delay between checks and the sensitivity threshold for change detection.
- **Multi-tab Management**: Monitor multiple pages simultaneously and manage all active sessions from a single interface.

## Installation

To install the extension:

1. Clone the repository with the command:
   ```bash
   git clone https://github.com/1vcian/Page-Change-Monitor
2. Open Chrome and navigate to chrome://extensions/
3. Enable "Developer mode" (toggle in the top right)
4. Click on "Load unpacked" and select the cloned folder
5. The extension will now be available in your browser toolbar 

## How It Works

1. Click on the "Select Area to Monitor" button and drag your mouse to select the portion of the page you want to check.
2. Set the delay after page load and the change detection threshold.
3. Click on "Start Monitoring" to begin automatic checking.
4. The extension will periodically reload the page and compare the selected area with the original image.
5. When a change is detected, you'll receive a notification and can view a detailed comparison between the two versions.

## Project Status

**⚠️ WARNING: This project is still under development and may contain bugs.**

Page Change Monitor is currently in beta and has some limitations and known issues:

- It may not work correctly on sites with Content Security Policy restrictions (such as YouTube and Google)
- In some cases, screenshot capture may fail
- Communication issues may occur between extension components

We are actively working to resolve these issues and improve the stability of the extension.

## Open Source

Page Change Monitor is and will always be completely open source. The source code is available for anyone who wants to contribute to the project, report bugs, or suggest improvements.

We encourage the community to participate in the development to make this extension increasingly robust and functional.

## Use Cases

- Check for updates on news sites or blogs
- Verify product or service availability
- Monitor changes in online documents or content
- Keep track of updates on forums or social media

## Technologies Used

- JavaScript
- Chrome Extension API
- HTML/CSS
- html2canvas for screenshot capture

## Contributing

If you'd like to contribute to the project, feel free to:

- Report bugs or issues
- Propose new features
- Submit pull requests with fixes or improvements
- Help with documentation

---

**Note**: This extension was created for educational and personal purposes. Use it responsibly and in compliance with the terms of service of the websites you monitor.
