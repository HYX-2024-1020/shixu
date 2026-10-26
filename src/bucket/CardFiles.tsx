import type { Attachment } from "./types";

// Card surfaces and details use the same attachment records; never invent placeholders.
export default function CardFiles({
  attachments,
  onOpen,
}: {
  attachments: Attachment[];
  onOpen: () => void;
}) {
  const files = attachments.filter((file) => !file.deletedAt);
  if (!files.length) return null;
  return (
    <div className="card-files" aria-label="同行附件">
      {files.map((file) => (
        <button
          key={file.id}
          className="card-file"
          onClick={onOpen}
          title={file.name}
        >
          <b>
            {file.name.includes(".")
              ? file.name.split(".").pop()!.slice(0, 5).toUpperCase()
              : "FILE"}
          </b>
          <span>{file.name}</span>
          <span aria-hidden="true">↗</span>
        </button>
      ))}
    </div>
  );
}
