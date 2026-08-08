import { useRef } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Compact "Import" button that opens the OS file explorer via a hidden
 * file input. Clicking the button triggers the native file picker; the
 * selected file is handed to `onFile`.
 */
export default function ImportButton({
  accept,
  disabled,
  onFile,
}: {
  accept?: string;
  disabled?: boolean;
  onFile: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
        Import
      </Button>
      <Input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null);
          // Reset so re-selecting the same file later still fires `onChange`.
          e.target.value = "";
        }}
      />
    </>
  );
}
