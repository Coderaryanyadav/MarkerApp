import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Image, ScrollView, Dimensions, ActivityIndicator } from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import { WebView } from 'react-native-webview';

const { width } = Dimensions.get('window');

const HTML_CONTENT = `
<!DOCTYPE html>
<html>
<head>
  <script async src="https://docs.opencv.org/4.8.0/opencv.js" onload="onOpenCvReady()"></script>
  <script>
    let cvReady = false;
    function onOpenCvReady() {
      cvReady = true;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    }

    function processImage(base64Image) {
      if (!cvReady) return;

      const img = new Image();
      img.onload = function() {
        const mat = cv.imread(img);
        const gray = new cv.Mat();
        cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
        
        const thresh = new cv.Mat();
        cv.adaptiveThreshold(gray, thresh, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);

        const contours = new cv.MatVector();
        const hierarchy = new cv.Mat();
        cv.findContours(thresh, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);

        let bestMarker = null;
        let maxArea = 0;

        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i);
          const area = cv.contourArea(contour);
          
          if (area > 1000) {
            const peri = cv.arcLength(contour, true);
            const approx = new cv.Mat();
            cv.approxPolyDP(contour, approx, 0.04 * peri, true);

            if (approx.rows === 4) {
              // Check hierarchy: Does this square have children?
              // The hierarchy is [next, prev, child, parent]
              const hasChild = hierarchy.data32S[i * 4 + 2] !== -1;
              if (hasChild && area > maxArea) {
                maxArea = area;
                bestMarker = approx.clone();
              }
            }
            approx.delete();
          }
        }

        if (bestMarker && maxArea > 10000) {
          const dsize = new cv.Size(300, 300);
          
          let pts = [];
          for(let i=0; i<4; i++) {
            pts.push({x: bestMarker.data32S[i*2], y: bestMarker.data32S[i*2+1]});
          }
          pts.sort((a,b) => a.y - b.y);
          let top = pts.slice(0, 2).sort((a,b) => a.x - b.x);
          let bottom = pts.slice(2, 4).sort((a,b) => b.x - a.x);
          
          const sortedSrcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            top[0].x, top[0].y,
            top[1].x, top[1].y,
            bottom[0].x, bottom[0].y,
            bottom[1].x, bottom[1].y
          ]);

          const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
            0, 0,
            300, 0,
            300, 300,
            0, 300
          ]);

          const M = cv.getPerspectiveTransform(sortedSrcPts, dstPts);
          const warped = new cv.Mat();
          cv.warpPerspective(mat, warped, M, dsize);
          // Final Structural Validation: Geometric Area Filtering
          let finalMat = new cv.Mat();
          let valid = false;

          cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
          cv.threshold(gray, thresh, 127, 255, cv.THRESH_BINARY_INV);
          
          let rect_inner = new cv.Rect(40, 40, 220, 220);
          let innerMat = thresh.roi(rect_inner);
          let innerArea = 220 * 220;
          
          let innerContours = new cv.MatVector();
          let innerHierarchy = new cv.Mat();
          cv.findContours(innerMat, innerContours, innerHierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          
          let dataBlobCount = 0;
          for (let j = 0; j < innerContours.size(); j++) {
            let cArea = cv.contourArea(innerContours.get(j));
            // Only count shapes that are within 'Data Block' size range
            if (cArea > innerArea * 0.005 && cArea < innerArea * 0.15) {
              dataBlobCount++;
            }
          }
          
          // Valid markers have multiple data blocks OR high nesting
          if (dataBlobCount >= 3 || (innerContours.size() >= 1 && dataBlobCount >= 1)) {
            let moments = cv.moments(innerMat, false);
            let cx = moments.m10 / moments.m00;
            let cy = moments.m01 / moments.m00;
            let dx = cx - 110;
            let dy = cy - 110;

            // Orientation logic
            if (dx <= 0 && dy <= 0) {
              warped.copyTo(finalMat);
            } else if (dx > 0 && dy <= 0) {
              cv.rotate(warped, finalMat, cv.ROTATE_90_COUNTERCLOCKWISE);
            } else if (dx > 0 && dy > 0) {
              cv.rotate(warped, finalMat, cv.ROTATE_180);
            } else {
              cv.rotate(warped, finalMat, cv.ROTATE_90_CLOCKWISE);
            }
            valid = true;
          }

          innerContours.delete();
          innerHierarchy.delete();
          innerMat.delete();

          if (valid) {
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300;
            cv.imshow(canvas, finalMat);
            const dataUrl = canvas.toDataURL('image/jpeg');
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'marker', data: dataUrl }));
          } else {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', data: 'Invalid marker' }));
          }

          finalMat.delete();
          warped.delete();
          M.delete();
          sortedSrcPts.delete();
          dstPts.delete();
          bestMarker.delete();
        } else {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', data: 'No marker found' }));
        }

        mat.delete();
        gray.delete();
        thresh.delete();
        contours.delete();
        hierarchy.delete();
      };
      img.src = 'data:image/jpeg;base64,' + base64Image;
    }

    document.addEventListener("message", function(event) {
      processImage(event.data);
    });
    window.addEventListener("message", function(event) {
      processImage(event.data);
    });
  </script>
</head>
<body></body>
</html>
`;

export default function App() {
  const [hasPermission, setHasPermission] = useState(null);
  const [markers, setMarkers] = useState([]);
  const cameraRef = useRef(null);
  const webviewRef = useRef(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cvReady, setCvReady] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const takePictureAndProcess = async () => {
    if (cameraRef.current && !isProcessing && cvReady && markers.length < 20) {
      setIsProcessing(true);
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.5,
          base64: true,
          skipProcessing: true
        });
        webviewRef.current.postMessage(photo.base64);
      } catch (error) {
        setIsProcessing(false);
      }
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      takePictureAndProcess();
    }, 1500);
    return () => clearInterval(interval);
  }, [isProcessing, cvReady, markers]);

  const onMessage = (event) => {
    const message = JSON.parse(event.nativeEvent.data);
    if (message.type === 'ready') {
      setCvReady(true);
    } else if (message.type === 'marker') {
      setMarkers(prev => {
        if (prev.length < 20) {
          return [...prev, message.data];
        }
        return prev;
      });
      setIsProcessing(false);
    } else {
      setIsProcessing(false);
    }
  };

  if (hasPermission === null) {
    return <View style={styles.container}><ActivityIndicator size="large" color="#ffffff" /></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={styles.statusText}>No access to camera</Text></View>;
  }

  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        type={CameraType.back}
        ref={cameraRef}
      >
        {/* Floating Header Pill */}
        <View style={styles.headerWrapper}>
          <View style={styles.floatingHeader}>
            <View style={styles.headerLeft}>
              <View style={styles.pulseDot} />
              <Text style={styles.headerText}>MARKER_OS v2.4</Text>
            </View>
            <View style={[styles.statusBadge, cvReady ? styles.statusReady : styles.statusLoading]}>
              <Text style={styles.statusBadgeText}>{cvReady ? "SYSTEM_ONLINE" : "BOOTING_CORES..."}</Text>
            </View>
          </View>
        </View>

        {/* Futuristic Scanning HUD */}
        <View style={styles.hudOverlay}>
          <View style={styles.reticleContainer}>
            <View style={[styles.corner, styles.tl]} />
            <View style={[styles.corner, styles.tr]} />
            <View style={[styles.corner, styles.bl]} />
            <View style={[styles.corner, styles.br]} />
            <View style={styles.scanLine} />
          </View>
          <Text style={styles.hudHint}>ALIGN MARKER WITHIN FRAME</Text>
        </View>

        {/* Data Chip Tray */}
        <View style={styles.uiOverlay}>
          <View style={styles.glassPanel}>
            <View style={styles.panelHeader}>
              <Text style={styles.panelTitle}>DATA_EXTRACTS</Text>
              <Text style={styles.counterText}>{markers.length}/20</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
              {markers.map((uri, idx) => (
                <View key={idx} style={styles.dataChip}>
                  <Image source={{ uri }} style={styles.markerImage} />
                  <View style={styles.chipFooter}>
                    <Text style={styles.chipText}>#{idx + 1}</Text>
                  </View>
                </View>
              ))}
              {markers.length === 0 && (
                <View style={styles.placeholderBox}>
                  <ActivityIndicator color="rgba(0, 255, 255, 0.3)" />
                  <Text style={styles.placeholderText}>AWAITING_INPUT...</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Camera>

      <WebView
        ref={webviewRef}
        source={{ html: HTML_CONTENT }}
        style={{ width: 0, height: 0, opacity: 0 }}
        onMessage={onMessage}
        javaScriptEnabled={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    flex: 1,
  },
  headerWrapper: {
    paddingTop: 60,
    alignItems: 'center',
    width: '100%',
  },
  floatingHeader: {
    backgroundColor: 'rgba(15, 15, 15, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 30,
    width: '90%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ffff',
    marginRight: 8,
    shadowColor: '#00ffff',
    shadowRadius: 10,
    shadowOpacity: 0.8,
  },
  headerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: 'System',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusReady: {
    backgroundColor: 'rgba(0, 255, 157, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 157, 0.5)',
  },
  statusLoading: {
    backgroundColor: 'rgba(255, 171, 0, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 171, 0, 0.5)',
  },
  statusBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1,
  },
  hudOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleContainer: {
    width: 280,
    height: 280,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#00ffff',
    borderWidth: 3,
  },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: 'rgba(0, 255, 255, 0.5)',
    top: '50%',
    shadowColor: '#00ffff',
    shadowRadius: 15,
    shadowOpacity: 1,
  },
  hudHint: {
    color: 'rgba(0, 255, 255, 0.6)',
    marginTop: 20,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 3,
  },
  uiOverlay: {
    position: 'absolute',
    bottom: 30,
    width: '100%',
    paddingHorizontal: 16,
  },
  glassPanel: {
    backgroundColor: 'rgba(10, 10, 10, 0.8)',
    borderRadius: 32,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  panelTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 4,
  },
  counterText: {
    color: '#00ffff',
    fontSize: 14,
    fontWeight: '900',
    fontFamily: 'System',
  },
  scrollContent: {
    paddingRight: 20,
  },
  dataChip: {
    marginRight: 16,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
    width: 100,
  },
  markerImage: {
    width: 100,
    height: 100,
  },
  chipFooter: {
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: 'rgba(0, 255, 255, 0.1)',
  },
  chipText: {
    color: '#00ffff',
    fontSize: 10,
    fontWeight: '900',
  },
  placeholderBox: {
    width: width - 80,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
    backgroundColor: 'rgba(0, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(0, 255, 255, 0.1)',
    borderStyle: 'dashed',
  },
  placeholderText: {
    color: 'rgba(0, 255, 255, 0.3)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 10,
  },
});
