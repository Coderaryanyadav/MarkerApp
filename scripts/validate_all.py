import cv2
import numpy as np
import os
import glob

def test_marker_logic(img_path):
    img = cv2.imread(img_path)
    if img is None: return False, "Read Error"
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    found_any_square = False
    for i, c in enumerate(contours):
        area = cv2.contourArea(c)
        if area > 1000:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.04 * peri, True)
            
            if len(approx) == 4:
                found_any_square = True
                pts = approx.reshape(4, 2)
                rect = np.zeros((4, 2), dtype='float32')
                s = pts.sum(axis=1); rect[0] = pts[np.argmin(s)]; rect[2] = pts[np.argmax(s)]
                diff = np.diff(pts, axis=1); rect[1] = pts[np.argmin(diff)]; rect[3] = pts[np.argmax(diff)]
                dst = np.array([[0,0],[300,0],[300,300],[0,300]], dtype='float32')
                M = cv2.getPerspectiveTransform(rect, dst)
                warped = cv2.warpPerspective(gray, M, (300, 300))
                
                # Strict Analysis: Fixed Threshold + Area Filter
                _, w_thresh = cv2.threshold(warped, 127, 255, cv2.THRESH_BINARY_INV)
                inner = w_thresh[40:260, 40:260]
                inner_area = 220 * 220
                i_cnts, _ = cv2.findContours(inner, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
                
                # Count only 'Data Size' blobs (0.5% to 15%)
                data_blobs = [cnt for cnt in i_cnts if inner_area * 0.005 < cv2.contourArea(cnt) < inner_area * 0.15]
                
                if len(data_blobs) >= 3:
                    return True, f"Success (DataBlobs:{len(data_blobs)})"
    
    return False, "Rejected (Insufficient Data Blobs)" if found_any_square else "No Border Detected"

print("-" * 60)
print(f"{'IMAGE SET':<40} | {'RESULT'}")
print("-" * 60)

test_sets = [
    ("../../Marker1-TestImages/Correct Marker Images/*", "Marker 1 (Correct)"),
    ("../../Marker1-TestImages/Incorrect Marker Images/*", "Marker 1 (Incorrect)"),
    ("../../Marker2-TestImages/Correct Marker Images/*", "Marker 2 (Correct)"),
    ("../../Marker2-TestImages/Incorrect Marker Images/*", "Marker 2 (Incorrect)"),
    ("../marker_tests/*.png", "My Custom Marker"),
]

for pattern, label in test_sets:
    files = glob.glob(pattern)
    total = len(files)
    passed = 0
    print(f"\n--- {label} ---")
    for f in files:
        success, detail = test_marker_logic(f)
        fname = os.path.basename(f)
        # For 'Incorrect' sets, 'success' (detecting a marker) is actually a failure
        is_pass = False
        if "Incorrect" in label:
            if not success: 
                passed += 1
                is_pass = True
        else:
            if success: 
                passed += 1
                is_pass = True
        
        status_str = "PASS" if is_pass else "FAIL"
        print(f"  {fname:<40} | {status_str:<5} | {detail}")
    
    print(f"Summary: {passed}/{total} Passed")

print("-" * 60)
