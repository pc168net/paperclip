import { useState, useRef, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload,
  Folder,
  FileArchive,
  FileText,
  Trash2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { readZipArchive } from "@/lib/zip";
import { agentsApi } from "@/api/agents";

interface StagedFile {
  path: string;
  content: string;
  size: number;
}

interface UploadInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  companyId?: string;
  onSuccess: (uploadedFiles: string[]) => void;
}

const IGNORED_NAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
]);

function shouldIgnorePath(pathStr: string): boolean {
  const normalized = pathStr.toLowerCase().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((seg) => seg === ".git" || seg === "node_modules" || seg === "__macosx")) {
    return true;
  }
  const filename = segments[segments.length - 1];
  if (!filename || IGNORED_NAMES.has(filename) || filename.startsWith("._")) {
    return true;
  }
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanRelativePath(pathStr: string): string {
  return pathStr
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .join("/");
}

export function UploadInstructionsDialog({
  open,
  onOpenChange,
  agentId,
  companyId,
  onSuccess,
}: UploadInstructionsDialogProps) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [pathPrefix, setPathPrefix] = useState("wiki/");
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const folderInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    if (isUploading) return;
    setStagedFiles([]);
    setErrorMessage(null);
    onOpenChange(false);
  };

  const addFiles = useCallback((newFiles: StagedFile[]) => {
    setStagedFiles((prev) => {
      const map = new Map(prev.map((f) => [f.path, f]));
      for (const file of newFiles) {
        map.set(file.path, file);
      }
      return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
    });
    setErrorMessage(null);
  }, []);

  const handleFolderSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      const added: StagedFile[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]!;
        const relPath = file.webkitRelativePath || file.name;
        if (shouldIgnorePath(relPath)) continue;

        const content = await file.text();
        const cleanPath = cleanRelativePath(relPath);
        if (!cleanPath) continue;
        added.push({
          path: cleanPath,
          content,
          size: file.size,
        });
      }
      addFiles(added);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to read folder contents");
    } finally {
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleZipSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const archive = await readZipArchive(arrayBuffer);
      const added: StagedFile[] = [];

      for (const [archivePath, entry] of Object.entries(archive.files)) {
        if (shouldIgnorePath(archivePath)) continue;
        const cleanPath = cleanRelativePath(archivePath);
        if (!cleanPath) continue;
        if (typeof entry === "string") {
          added.push({
            path: cleanPath,
            content: entry,
            size: new TextEncoder().encode(entry).length,
          });
        }
      }

      if (added.length === 0) {
        setErrorMessage("No valid text or markdown files found in the zip archive.");
      } else {
        addFiles(added);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to extract zip archive");
    } finally {
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleFilesSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    try {
      const added: StagedFile[] = [];
      const prefix = cleanRelativePath(pathPrefix);
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]!;
        if (shouldIgnorePath(file.name)) continue;

        const content = await file.text();
        const cleanName = cleanRelativePath(file.name);
        if (!cleanName) continue;
        const fullPath = prefix ? `${prefix}/${cleanName}` : cleanName;
        added.push({
          path: fullPath,
          content,
          size: file.size,
        });
      }
      addFiles(added);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to read files");
    } finally {
      if (filesInputRef.current) filesInputRef.current.value = "";
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const items = event.dataTransfer.items;
    const files = event.dataTransfer.files;

    if (!files || files.length === 0) return;

    try {
      const zipFile = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".zip"));
      if (zipFile) {
        const arrayBuffer = await zipFile.arrayBuffer();
        const archive = await readZipArchive(arrayBuffer);
        const added: StagedFile[] = [];
        for (const [archivePath, entry] of Object.entries(archive.files)) {
          if (shouldIgnorePath(archivePath)) continue;
          const cleanPath = cleanRelativePath(archivePath);
          if (!cleanPath) continue;
          if (typeof entry === "string") {
            added.push({
              path: cleanPath,
              content: entry,
              size: new TextEncoder().encode(entry).length,
            });
          }
        }
        addFiles(added);
        return;
      }

      const added: StagedFile[] = [];
      const prefix = cleanRelativePath(pathPrefix);
      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        if (shouldIgnorePath(file.name)) continue;
        const content = await file.text();
        const cleanName = cleanRelativePath(file.name);
        if (!cleanName) continue;
        const fullPath = prefix ? `${prefix}/${cleanName}` : cleanName;
        added.push({
          path: fullPath,
          content,
          size: file.size,
        });
      }
      addFiles(added);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to process dropped files");
    }
  };

  const removeStagedFile = (pathToRemove: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.path !== pathToRemove));
  };

  const handleUpload = async () => {
    if (stagedFiles.length === 0) return;
    setIsUploading(true);
    setErrorMessage(null);

    try {
      const payloadFiles = stagedFiles.map((f) => ({
        path: f.path,
        content: f.content,
      }));

      const res = await agentsApi.uploadInstructionsFiles(
        agentId,
        {
          files: payloadFiles,
          overwrite: true,
        },
        companyId,
      );

      onSuccess(res.files);
      handleClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const totalBytes = stagedFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-(--sz-85vh) flex flex-col p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4" />
            Upload Wiki or Files to Instructions
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload an entire Wiki folder, documentation files, or a .zip archive. All uploaded files will be stored in this agent’s instructions bundle and can be viewed, edited, and referenced by the agent.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 my-2 overflow-y-auto flex-1 pr-1">
          {/* Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border bg-muted/20"
            }`}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Drag & drop files or folder here</p>
            <p className="text-xs text-muted-foreground mt-1 mb-4">
              Supports markdown, text, documentation folders, or .zip archives
            </p>

            <div className="flex flex-wrap justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => folderInputRef.current?.click()}
              >
                <Folder className="h-3.5 w-3.5 mr-1.5" />
                Select Folder (Wiki)
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => zipInputRef.current?.click()}
              >
                <FileArchive className="h-3.5 w-3.5 mr-1.5" />
                Select .zip Archive
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => filesInputRef.current?.click()}
              >
                <FileText className="h-3.5 w-3.5 mr-1.5" />
                Select Individual Files
              </Button>
            </div>

            {/* Hidden Inputs */}
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is standard in browsers but non-standard in TS React typing
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderSelect}
            />
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleZipSelect}
            />
            <input
              ref={filesInputRef}
              type="file"
              multiple
              accept=".md,.markdown,.txt,.json,.yaml,.yml"
              className="hidden"
              onChange={handleFilesSelect}
            />
          </div>

          {/* Path prefix setting */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground whitespace-nowrap">Default folder prefix for individual files:</span>
            <Input
              value={pathPrefix}
              onChange={(e) => setPathPrefix(e.target.value)}
              placeholder="wiki/"
              className="h-7 text-xs font-mono max-w-48"
            />
          </div>

          {/* Error notice */}
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 rounded-md border border-destructive/30 bg-destructive/10 text-destructive text-xs">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Staged files preview */}
          {stagedFiles.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/40 px-3 py-2 flex items-center justify-between border-b border-border text-xs">
                <span className="font-medium">
                  {stagedFiles.length} file{stagedFiles.length > 1 ? "s" : ""} selected ({formatBytes(totalBytes)})
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => setStagedFiles([])}
                >
                  Clear all
                </Button>
              </div>

              <div className="max-h-48 overflow-y-auto divide-y divide-border font-mono text-xs">
                {stagedFiles.map((file) => (
                  <div key={file.path} className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/20">
                    <span className="truncate mr-2" title={file.path}>
                      {file.path}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-muted-foreground text-xs">{formatBytes(file.size)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                        onClick={() => removeStagedFile(file.path)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 pt-2 border-t border-border flex items-center justify-between sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {stagedFiles.length > 0 ? `${stagedFiles.length} files ready to upload` : "No files selected yet"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={handleClose}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={stagedFiles.length === 0 || isUploading}
              onClick={handleUpload}
            >
              {isUploading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Uploading...
                </>
              ) : (
                `Upload ${stagedFiles.length > 0 ? `(${stagedFiles.length})` : ""}`
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
