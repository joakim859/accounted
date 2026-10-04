import sharp from 'sharp'
import { isShrinkableImage } from './upload-size'

/**
 * Re-encode a receipt/underlag photo for long-term archival storage,
 * independently of whatever bytes are used for AI extraction.
 *
 * WHY THIS EXISTS (self-host fork addition, 2026-09-04):
 *
 * A phone camera photo of a receipt routinely runs 3-8 MB (16M-colour JPEG,
 * 12+ MP). AI vision extraction genuinely benefits from that full resolution
 * and colour depth, so lib/ai never sees a shrunk copy: callers must keep
 * passing the ORIGINAL buffer to extraction (extractInvoiceFields /
 * processArchivedDocument) and only swap in this function's output for the
 * bytes handed to uploadDocument(). The two must not be the same buffer.
 *
 * We deliberately do NOT do this as a later, in-place edit of an already
 * archived document. document_attachments is WORM by design (RLS denies
 * UPDATE/DELETE to the `authenticated` role; see
 * 20240101000024_storage_bucket_policies.sql and the near-miss closed in
 * 20260727190000_drop_documents_bucket_delete_policy.sql) specifically so
 * rakenskapsinformation can't be silently altered after the fact (BFL 7 kap
 * 2 §, seven-year retention). A background job that downloads the archived
 * original, shrinks it, and overwrites the same storage object with
 * service_role would technically work (service_role is exempt from that
 * RLS) but would break the sha256_hash integrity guarantee and leave the
 * document_attachments row looking completely unchanged, which is exactly
 * the kind of undetectable retroactive edit WORM exists to prevent.
 * Compressing BEFORE the first archive write sidesteps the question
 * entirely: nothing immutable exists yet, so there is nothing to alter.
 * (Considered and rejected 2026-09-03; see hjp-infra-docs/next-steps.md.)
 *
 * Not a byte-ceiling tool like the client-side shrinkImageForUpload
 * (lib/documents/shrink-image.ts, browser canvas, targets
 * HOSTED_MAX_UPLOAD_BYTES): this always runs, for every shrinkable image
 * over SKIP_BELOW_BYTES, purely to cut long-term storage. Returns the
 * original buffer whenever re-encoding would not obviously help — a
 * corrupt/undecodable image must fail the same way it would have without
 * this step, not silently vanish from the archive.
 */

// Below this, sharp's own overhead plus JPEG re-encoding artifacts are not
// worth it: most already-compressed small receipts saved from a screenshot
// or a well-compressed camera app land under this without help.
const SKIP_BELOW_BYTES = 300 * 1024

// Receipts are read on a screen, not printed poster-size: 2000px on the long
// edge keeps every digit and line item legible while cutting a 12 MP photo's
// pixel count by roughly 4x before JPEG encoding even starts.
const MAX_EDGE_PX = 2000

// mozjpeg's default quality range where legibility of small receipt print
// holds up well in practice; well above the point where JPEG blocking starts
// eating digits.
const JPEG_QUALITY = 82

export async function shrinkImageForStorage(
  buffer: ArrayBuffer,
  mimeType: string | undefined,
): Promise<{ buffer: ArrayBuffer; mimeType: string }> {
  const original = { buffer, mimeType: mimeType ?? 'application/octet-stream' }

  if (buffer.byteLength <= SKIP_BELOW_BYTES) return original
  if (!isShrinkableImage(mimeType)) return original

  try {
    const input = Buffer.from(buffer)
    const shrunk = await sharp(input)
      .rotate() // bake in EXIF orientation before dropping the EXIF block below
      .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer()

    // Never let an oddity (already-tiny image, PNG line art that JPEGs
    // worse) make the archive bigger than the original.
    if (shrunk.byteLength >= buffer.byteLength) return original

    return { buffer: shrunk.buffer.slice(shrunk.byteOffset, shrunk.byteOffset + shrunk.byteLength), mimeType: 'image/jpeg' }
  } catch {
    // A sharp failure (corrupt image, unsupported HEIC variant, etc.) must
    // not block the upload: fall through to archiving the original, exactly
    // as if this function did not exist. validateDocumentMagicBytes in
    // uploadDocument still gets the final say on whether the bytes are
    // acceptable.
    return original
  }
}
