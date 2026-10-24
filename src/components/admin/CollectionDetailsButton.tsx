"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import CollectionModal, { type EditableCollection } from "./CollectionModal";

/** "Edit details" on a collection's page — opens the shared CollectionModal. */
export default function CollectionDetailsButton({ collection }: { collection: EditableCollection }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit details
      </button>
      <CollectionModal collection={collection} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
