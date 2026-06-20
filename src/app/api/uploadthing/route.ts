import { createRouteHandler } from "uploadthing/next";
import { ourFileRouter } from "./core";

/**
 * UploadThing route handler.
 * Reads the UPLOADTHING_TOKEN env var automatically — set it in .env.
 */
export const { GET, POST } = createRouteHandler({
  router: ourFileRouter,
});
