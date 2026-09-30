# Project architecture

- Approved phone users are pre-provisioned in Lovable Cloud Auth; OTP verification must not require a privileged server client so externally hosted builds can sign in without private backend keys.
- Attendance proof selfies are uploaded as low-bandwidth JPEGs (maximum 480px edge, quality 0.38) because they are operational thumbnails, not archival photos.
- The installed Android/iOS shell uses the PLUS 360 production domain and native biometric plugins; OTP enrolls a device once, then secure biometric unlock protects relaunch and attendance actions.