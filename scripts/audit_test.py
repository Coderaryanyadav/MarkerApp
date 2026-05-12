import cv2
import numpy as np
import os
import time

def audit_marker_detection(image_path, output_dir):
    start_time = time.time()
    img = cv2.imread(image_path)
    if img is None:
        return False, "Could not read image", 0
    
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Replicate the app logic: Adaptive Threshold
    thresh = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2)
    
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    
    best_marker = None
    max_area = 0
    
    for c in contours:
        area = cv2.contourArea(c)
        if area > 1000:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.04 * peri, True)
            if len(approx) == 4:
                if area > max_area:
                    max_area = area
                    best_marker = approx

    if best_marker is not None:
        # Extract 300x300
        pts = best_marker.reshape(4, 2)
        # Sort points: TL, TR, BR, BL
        rect = np.zeros((4, 2), dtype="float32")
        s = pts.sum(axis=1)
        rect[0] = pts[np.argmin(s)]
        rect[2] = pts[np.argmax(s)]
        diff = np.diff(pts, axis=1)
        rect[1] = pts[np.argmin(diff)]
        rect[3] = pts[np.argmax(diff)]
        
        dst = np.array([
            [0, 0],
            [300, 0],
            [300, 300],
            [0, 300]], dtype="float32")
        
        M = cv2.getPerspectiveTransform(rect, dst)
        warped = cv2.warpPerspective(img, M, (300, 300))
        
        # Orientation correction logic
        warped_gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
        _, w_thresh = cv2.threshold(warped_gray, 127, 255, cv2.THRESH_BINARY)
        
        # Check corners (TL, TR, BL, BR)
        tl = w_thresh[50, 50]
        tr = w_thresh[50, 250]
        bl = w_thresh[250, 50]
        br = w_thresh[250, 250]
        
        final_img = warped
        rotation = "0 deg"
        
        # White (255) corner is BR
        if br > 127 and tl < 127 and tr < 127 and bl < 127:
            rotation = "0 deg (Correct)"
        elif tr > 127 and tl < 127 and bl < 127 and br < 127:
            final_img = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
            rotation = "90 deg corrected"
        elif tl > 127 and tr < 127 and bl < 127 and br < 127:
            final_img = cv2.rotate(warped, cv2.ROTATE_180)
            rotation = "180 deg corrected"
        elif bl > 127 and tl < 127 and tr < 127 and br < 127:
            final_img = cv2.rotate(warped, cv2.ROTATE_90_COUNTERCLOCKWISE)
            rotation = "270 deg corrected"
        else:
            rotation = "Unknown / Pattern Mismatch"

        filename = os.path.basename(image_path)
        cv2.imwrite(os.path.join(output_dir, f"audit_{filename}"), final_img)
        
        end_time = time.time()
        return True, rotation, (end_time - start_time) * 1000

    return False, "No marker detected", 0

if __name__ == "__main__":
    os.makedirs('AuditResults', exist_ok=True)
    test_dir = 'CustomMarkerTests'
    images = [f for f in os.listdir(test_dir) if f.endswith('.png') and 'Base' not in f]
    
    print("-" * 50)
    print(f"{'IMAGE':<30} | {'STATUS':<15} | {'TIME (ms)':<10}")
    print("-" * 50)
    
    for img_name in images:
        path = os.path.join(test_dir, img_name)
        success, info, duration = audit_marker_detection(path, 'AuditResults')
        status = "PASS" if success else "FAIL"
        print(f"{img_name:<30} | {status:<15} | {duration:<10.2f}")
        print(f"  -> Detail: {info}")
    
    print("-" * 50)
    print("Audit Complete. Extracted results saved in 'AuditResults' folder.")
