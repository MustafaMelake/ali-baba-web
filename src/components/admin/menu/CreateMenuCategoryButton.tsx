"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import MenuCategoryModal from "@/components/admin/menu/MenuCategoryModal";

/**
 * Client island for the (Server Component) menu page header action: owns the
 * open state and renders the create modal.
 */
export default function CreateMenuCategoryButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" />
        New Category
      </button>

      <MenuCategoryModal category={null} isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
