import { createUploadthing, type FileRouter } from "uploadthing/next";
import { UploadThingError } from "uploadthing/server";
import { auth } from "@/lib/auth";

const f = createUploadthing();

/**
 * Authorizes an upload from the incoming request's session.
 *
 * Runs on the server before the upload is allowed — this is the real gate, so
 * only admins can ever push files into our UploadThing bucket. Whatever this
 * returns becomes `metadata` in `onUploadComplete`.
 */
async function requireAdminUploader(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session || session.user.role !== "ADMIN") {
    throw new UploadThingError("Unauthorized — admin access required.");
  }
  return { userId: session.user.id };
}

export const ourFileRouter = {
  // Product gallery — up to 4 images.
  productImage: f({ image: { maxFileSize: "4MB", maxFileCount: 4 } })
    .middleware(({ req }) => requireAdminUploader(req))
    .onUploadComplete(({ metadata, file }) => {
      // The returned object is forwarded to the client's onClientUploadComplete.
      return { uploadedBy: metadata.userId, ufsUrl: file.ufsUrl };
    }),

  // Single hero image for a category card.
  categoryImage: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
    .middleware(({ req }) => requireAdminUploader(req))
    .onUploadComplete(({ metadata, file }) => {
      return { uploadedBy: metadata.userId, ufsUrl: file.ufsUrl };
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
