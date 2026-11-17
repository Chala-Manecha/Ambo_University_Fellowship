import { useState } from "react";

const SIDE = 480;

/**
 * Picks a photo and turns it into a 480×480 WebP square (centre crop) in the browser,
 * so uploads are small on mobile data. Falls back to the original file if that fails.
 */
export function PhotoInput({ current, error }: { current: string | null; error?: string }) {
  const [preview, setPreview] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      const side = Math.min(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(SIDE, side);
      canvas.getContext("2d")!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/webp", 0.85));
      if (blob && blob.type === "image/webp") {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], "photo.webp", { type: "image/webp" }));
        input.files = dt.files;
        setPreview(URL.createObjectURL(blob));
      } else {
        setPreview(URL.createObjectURL(file));
      }
    } catch {
      setPreview(URL.createObjectURL(file));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="photo-input">
      {preview ? <img src={preview} alt="Your photo" className="photo-preview" /> : <span className="photo-preview photo-empty" aria-hidden="true">👤</span>}
      <label className="btn btn-quiet btn-sm photo-pick">
        {busy ? "Preparing…" : preview ? "Choose another photo" : "Choose a photo"}
        <input type="file" name="photo" accept="image/*" required onChange={onChange} className="visually-hidden" />
      </label>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
