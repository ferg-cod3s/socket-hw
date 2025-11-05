'use client';

import { useState, useRef, DragEvent, ChangeEvent } from 'react';

interface FileUploadProps {
  onUpload: (file: File | FileList) => void;
  isScanning: boolean;
}

const ALLOWED_EXTENSIONS = ['.json', '.lock', '.txt', '.yaml', '.yml', '.toml', '.mod', '.sum'];

export function FileUpload({ onUpload, isScanning }: FileUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isDirectoryMode, setIsDirectoryMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (isScanning) return;

    // Check if file extension is allowed
    const hasValidExtension = ALLOWED_EXTENSIONS.some(ext =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      alert(`Unsupported file type. Please upload one of: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return;
    }

    setSelectedFile(file);
    onUpload(file);
  };

  // Recursively read all files from a directory entry
  const readDirectory = async (
    entry: FileSystemDirectoryEntry,
    rootName: string
  ): Promise<File[]> => {
    const files: File[] = [];
    const reader = entry.createReader();

    return new Promise((resolve, reject) => {
      const readEntries = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(files);
            return;
          }

          for (const entry of entries) {
            if (entry.isFile) {
              const fileEntry = entry as FileSystemFileEntry;
              const file = await new Promise<File>((resolve, reject) => {
                fileEntry.file(resolve, reject);
              });
              // Add webkitRelativePath for consistency with input[webkitdirectory]
              // Format: rootFolderName/path/to/file.txt
              const relativePath = rootName + entry.fullPath;
              Object.defineProperty(file, 'webkitRelativePath', {
                value: relativePath,
                writable: false
              });
              files.push(file);
            } else if (entry.isDirectory) {
              const subFiles = await readDirectory(entry as FileSystemDirectoryEntry, rootName);
              files.push(...subFiles);
            }
          }

          // Continue reading if there are more entries
          readEntries();
        }, reject);
      };

      readEntries();
    });
  };

  // Drag event handlers
  const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isScanning) {
      setIsDragActive(true);
    }
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (isScanning) return;

    const items = e.dataTransfer.items;

    // Check if a folder was dropped (items API can detect this)
    if (items && items.length > 0) {
      const firstItem = items[0];
      if (firstItem.webkitGetAsEntry) {
        const entry = firstItem.webkitGetAsEntry();
        if (entry && entry.isDirectory) {
          // Handle directory drop by recursively reading all files
          try {
            const dirFiles = await readDirectory(entry as FileSystemDirectoryEntry, entry.name);
            if (dirFiles.length === 0) {
              alert('The selected folder is empty.');
              return;
            }

            console.log(`[FileUpload] Read ${dirFiles.length} files from directory:`, entry.name);
            console.log('[FileUpload] Sample files:', dirFiles.slice(0, 3).map(f => ({
              name: f.name,
              webkitRelativePath: (f as any).webkitRelativePath,
              size: f.size
            })));

            // Create a FileList-like object
            const fileList = Object.assign(dirFiles, {
              item: (index: number) => dirFiles[index] || null
            }) as unknown as FileList;

            setSelectedDirectory(entry.name);
            setSelectedFile(null);
            onUpload(fileList);
            return;
          } catch (error) {
            console.error('Error reading directory:', error);
            alert('Failed to read folder contents. Please try using the folder upload button instead.');
            return;
          }
        }
      }
    }

    // Handle single file drop
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  // File input change handler
  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  // Directory input change handler
  const handleDirectoryInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Get directory name from first file's webkitRelativePath
      const firstFile = files[0];
      const pathParts = (firstFile as unknown as { webkitRelativePath?: string }).webkitRelativePath?.split('/') || [];
      const dirName = pathParts[0] || 'Selected folder';

      setSelectedDirectory(dirName);
      setSelectedFile(null);
      onUpload(files);
    }
  };

  // Click to trigger file or directory input
  const handleClick = () => {
    if (isScanning) return;

    if (isDirectoryMode && dirInputRef.current) {
      dirInputRef.current.click();
    } else if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Toggle between file and directory mode
  const toggleMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDirectoryMode(!isDirectoryMode);
    setSelectedFile(null);
    setSelectedDirectory(null);
  };

  return (
    <div className="w-full max-w-2xl">
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-label="Upload lockfile"
        className={`
          border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
          transition-colors duration-200 outline-none
          ${isDragActive ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-gray-300 dark:border-gray-700'}
          ${isScanning ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-400 hover:bg-gray-50 dark:hover:bg-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500'}
        `}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(',')}
          onChange={handleFileInputChange}
          disabled={isScanning}
          className="hidden"
          aria-label="File input"
        />

        <input
          ref={dirInputRef}
          type="file"
          {...({ webkitdirectory: '' } as any)}
          onChange={handleDirectoryInputChange}
          disabled={isScanning}
          className="hidden"
          aria-label="Directory input"
        />

        <div className="flex flex-col items-center gap-4 pointer-events-none">
          {/* Upload Icon */}
          <svg
            className="w-16 h-16 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          {/* Text Content */}
          {isDragActive ? (
            <p className="text-lg text-blue-600 dark:text-blue-400 font-medium">
              Drop your {isDirectoryMode ? 'folder' : 'file or folder'} here...
            </p>
          ) : (
            <>
              <p className="text-lg text-gray-700 dark:text-gray-300 font-medium">
                {isDirectoryMode
                  ? 'Drag & drop a folder or click to browse'
                  : 'Drag & drop your lockfile or folder, or click to browse'}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Supports: package-lock.json, pnpm-lock.yaml, yarn.lock,
                go.mod, go.sum, requirements.txt, poetry.lock
              </p>
              <button
                onClick={toggleMode}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 pointer-events-auto"
                disabled={isScanning}
              >
                {isDirectoryMode ? '← Switch to file upload' : 'Switch to folder upload →'}
              </button>
            </>
          )}

          {/* Selected File/Folder Indicator */}
          {(selectedFile || selectedDirectory) && !isScanning && (
            <div className="mt-4 px-4 py-2 bg-green-100 dark:bg-green-900 rounded-md">
              <p className="text-sm text-green-800 dark:text-green-200">
                ✓ Selected: {selectedDirectory || selectedFile?.name}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
