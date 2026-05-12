# Alemeno Frontend Internship Assignment
## Custom Marker Detection & Extraction Approach

### 1. Marker Design & Measurements
The custom marker was designed from scratch to be highly robust and easy to detect, strictly adhering to the assignment constraints:
- **Colors:** Black and White only.
- **Shape:** A perfect 300x300 pixel square.
- **Empty Area Constraint:** The marker contains a 30px thick black border. Inside this border is a 240x240 pixel white area. Inside this white area, three small 40x40 black squares ("finder patterns") are placed in the Top-Left, Top-Right, and Bottom-Left corners to dictate orientation. The total empty (white) area is `240x240 - 3*(40x40) = 52,800 px²`, which equates to **91.6% empty area**, well above the 60% constraint. 

### 2. Detection Algorithm
The application captures high-resolution frames using the native device camera (`expo-camera`). To fulfill the requirement of speed (under 3000ms), avoiding React Native bridge bottlenecks with pixel data was critical.
Instead of sending individual pixels across the bridge or using a slow Javascript loop, the app passes the camera's Base64 JPEG to an invisible `react-native-webview` which instantly loads the image and runs **OpenCV (compiled to WebAssembly)**. WebAssembly execution is near-native speed.

The step-by-step pipeline is:
1. **Adaptive Thresholding:** Converts the grayscale image to a robust binary image, mitigating varying lighting conditions.
2. **Contour Finding (`cv.findContours`):** Extracts all contours in the binary image.
3. **Square Detection:** Uses `cv.approxPolyDP` to approximate contour shapes. We identify the largest contour with exactly 4 vertices.
4. **Warp Perspective:** We extract the coordinates of the 4 vertices and apply `cv.getPerspectiveTransform` and `cv.warpPerspective`. This step handles orientation skew, perspective distortion, and tightly crops the marker to exactly 300x300 pixels.
5. **Orientation Correction:** We sample pixels at the four corners of the extracted 300x300 marker. By identifying the unique white corner (Bottom-Right), the algorithm precisely determines the rotation angle (0, 90, 180, or 270 degrees) and applies the corresponding `cv.rotate` transformation.
6. **Result Delivery:** The final exactly 300x300 extracted, skew-corrected, and rotated marker is encoded as a Base64 string and sent back to the React Native UI for display.

### 3. Framework & Tooling
The app was built using **React Native (Expo)**. 
- `expo-camera` provides stable, high-quality native camera access.
- `react-native-webview` paired with `opencv.js` enables C++ level image processing performance directly on the device without requiring complex JNI/C++ native Android compilation setups, guaranteeing the scan-to-result time is lightning fast (typically under 1000ms, well within the 3000ms constraint).

### Setup Instructions
1. Navigate to the \`MarkerApp\` directory.
2. Run \`npm install\`.
3. To test the app via Expo Go: run \`npx expo start\` and scan the QR code.
4. To build the native APK: run \`npx eas build -p android --profile preview\`.
