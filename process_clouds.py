import os
import shutil
from PIL import Image

def process_clouds():
    img_path = r"C:\Users\18086\Desktop\ai\app-gamify-new\public\assets\seam_clouds.png"
    backup_path = r"C:\Users\18086\Desktop\ai\app-gamify-new\public\assets\seam_clouds_backup.png"

    # Restore from the original backup to prevent losing image detail
    if os.path.exists(backup_path):
        shutil.copy(backup_path, img_path)
        print("[+] Restored original black-backed image from backup.")
    else:
        shutil.copy(img_path, backup_path)
        print("[+] Original backup created.")

    img = Image.open(img_path).convert("RGBA")
    pixels = img.load()
    width, height = img.size

    # Keying threshold (black point)
    black_point = 65

    # 🔒 Fade borders (feathering vignette) to eliminate boxy card edges
    # Left and right edges fade to transparent over 18% of the image width
    fade_w = int(width * 0.18)
    # Top and bottom edges fade to transparent over 15% of the image height
    fade_h = int(height * 0.15)

    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            val = max(r, g, b)
            
            # 1. Base keying alpha calculation
            if val <= black_point:
                base_alpha = 0
            else:
                base_alpha = int((val - black_point) * 255 / (255 - black_point))
                base_alpha = min(max(base_alpha, 0), 255)
            
            # 2. Horizontal edge fade multiplier
            factor_x = 1.0
            if x < fade_w:
                factor_x = x / fade_w
            elif x > width - fade_w:
                factor_x = (width - x) / fade_w
                
            # 3. Vertical edge fade multiplier
            factor_y = 1.0
            if y < fade_h:
                factor_y = y / fade_h
            elif y > height - fade_h:
                factor_y = (height - y) / fade_h

            # Combine alpha with edge multipliers (vignette feathering)
            final_alpha = int(base_alpha * factor_x * factor_y)
            pixels[x, y] = (r, g, b, final_alpha)

    img.save(img_path, "PNG")
    print(f"[+] High-precision feathering keyer finished. Saved to: {img_path}")

if __name__ == "__main__":
    process_clouds()
