# Project architecture

- Day Patrol includes active login-enabled staff across roles, while manager views use their own identity and reporting subtree; field-officer-only unit scopes stay separate so expanding the roster does not broaden financial access.

- Approved phone users are pre-provisioned in Lovable Cloud Auth; OTP verification must not require a privileged server client so externally hosted builds can sign in without private backend keys.
- Attendance proof selfies are uploaded as low-bandwidth JPEGs (maximum 480px edge, quality 0.38) because they are operational thumbnails, not archival photos.
- The installed Android/iOS shell uses the PLUS 360 production domain and native biometric plugins; OTP enrolls a device once, then secure biometric unlock protects relaunch and attendance actions.
- Dashboard secondary panels use an in-flow sticky rail rather than viewport-fixed positioning, so shared navigation can never cover panel headers.
- The mobile/native dock must reserve matching document space; internal-scroll pages must subtract its clearance so final actions remain reachable.- Native shell: fresh install or new native build always starts at login (src/lib/native-install-guard.ts stamps the build; Android backups disabled) — because restored storage/Keychain otherwise resurrects old sessions.
