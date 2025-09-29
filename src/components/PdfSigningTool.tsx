import React, { useEffect, useRef, useState } from "react";
import {
  Upload,
  Button,
  Space,
  Row,
  Col,
  Slider,
  message,
  Typography,
} from "antd";
import {
  UploadOutlined,
  DownloadOutlined,
  ClearOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import { Document, Page, pdfjs } from "react-pdf";
import { PDFDocument } from "pdf-lib";
import { Rnd } from "react-rnd";

// Local pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.js";
const { Text } = Typography;

/* ----------------- Types ------------------ */
type PlacedSignature = {
  id: string;
  page: number;
  imgDataUrl: string;
  displayX: number;
  displayY: number;
  displayW: number;
  displayH: number;
};

type ViewportInfo = {
  width: number;
  height: number;
  pdfWidth: number;
  pdfHeight: number;
};

/* ----------------- Helpers ------------------ */
const dataURLtoUint8Array = (dataURL: string) => {
  const base64 = dataURL.split(",")[1];
  const binary = atob(base64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });

/* ----------------- Main Component ------------------ */
export default function PdfSigningTool() {
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(
    null
  );
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [placedSignatures, setPlacedSignatures] = useState<PlacedSignature[]>(
    []
  );

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawing = useRef(false);
  const pageContainersRef = useRef<Record<number, HTMLDivElement | null>>({});
  const pageViewportSizes = useRef<Record<number, ViewportInfo>>({});
  const pdfLibDocRef = useRef<PDFDocument | null>(null);

  /* ----------- Init signature pad ----------- */
  useEffect(() => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "black";
    }
  }, []);

  /* ----------- Signature Drawing ----------- */
  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    sigDrawing.current = true;
    const { left, top } = canvas.getBoundingClientRect();
    canvas.getContext("2d")?.beginPath();
    canvas.getContext("2d")?.moveTo(e.clientX - left, e.clientY - top);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sigDrawing.current) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const { left, top } = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    ctx?.lineTo(e.clientX - left, e.clientY - top);
    ctx?.stroke();
  };
  const endDraw = () => (sigDrawing.current = false);
  const clearSig = () =>
    sigCanvasRef.current?.getContext("2d")?.clearRect(0, 0, 600, 200);

  /* ----------- Upload Handlers ----------- */
  const beforePdfUpload = async (file: File) => {
    try {
      if (file.type !== "application/pdf") {
        message.error("Please upload a valid PDF file.");
        return false;
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      setPdfArrayBuffer(arrayBuffer);
      pdfLibDocRef.current = pdfDoc;
      setNumPages(pdfDoc.getPageCount());
      message.success(`${file.name} loaded successfully`);
    } catch {
      message.error("Failed to load PDF. Please upload a valid file.");
    }
    return false;
  };

  const beforeSigUpload = async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const canvas = sigCanvasRef.current;
      if (!canvas) return false;
      const ctx = canvas.getContext("2d");
      if (!ctx) return false;

      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const maxW = canvas.width * 0.9;
        const maxH = canvas.height * 0.9;
        const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        ctx.drawImage(
          img,
          (canvas.width - img.width * ratio) / 2,
          (canvas.height - img.height * ratio) / 2,
          img.width * ratio,
          img.height * ratio
        );
      };
      message.success("Signature image loaded into pad");
    } catch {
      message.error("Failed to load signature image.");
    }
    return false;
  };

  /* ----------- Page Handlers ----------- */
  const onPageRenderSuccess = (pageNumber: number) => {
    const container = pageContainersRef.current[pageNumber];
    if (!container || !pdfLibDocRef.current) return;
    const page = pdfLibDocRef.current.getPage(pageNumber - 1);
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    const rect = container.getBoundingClientRect();
    pageViewportSizes.current[pageNumber] = {
      width: rect.width,
      height: rect.height,
      pdfWidth,
      pdfHeight,
    };
  };

  const onPageClick = (
    e: React.MouseEvent<HTMLDivElement>,
    pageNumber: number
  ) => {
    const container = pageContainersRef.current[pageNumber];
    if (!container || !sigCanvasRef.current) return;
    const rect = container.getBoundingClientRect();
    const { clientX, clientY } = e;
    const viewport = pageViewportSizes.current[pageNumber];
    if (!viewport) return;

    const dataUrl = sigCanvasRef.current.toDataURL("image/png");
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const aspect = img.height / img.width;
      const displayW = viewport.width * 0.3;
      const displayH = displayW * aspect;
      setPlacedSignatures((sigs) => [
        ...sigs,
        {
          id: `${Date.now()}`,
          page: pageNumber,
          imgDataUrl: dataUrl,
          displayX: clientX - rect.left - displayW / 2,
          displayY: clientY - rect.top - displayH / 2,
          displayW,
          displayH,
        },
      ]);
      message.success("Signature placed, drag/resize to adjust.");
    };
  };

  /* ----------- Apply Signatures ----------- */
  const applySignaturesAndDownload = async () => {
    if (!pdfLibDocRef.current || !pdfArrayBuffer) {
      message.warning("Load a PDF first");
      return;
    }
    try {
      const pdfDoc = await PDFDocument.load(pdfArrayBuffer);

      for (const sig of placedSignatures) {
        const viewport = pageViewportSizes.current[sig.page];
        if (!viewport) continue;

        const pxPerPdfPointX = viewport.width / viewport.pdfWidth;
        const pxPerPdfPointY = viewport.height / viewport.pdfHeight;
        const pdfX = sig.displayX / pxPerPdfPointX;
        const pdfY =
          (viewport.height - (sig.displayY + sig.displayH)) / pxPerPdfPointY;

        const pngBytes = dataURLtoUint8Array(sig.imgDataUrl);
        const pngImage = await pdfDoc.embedPng(pngBytes);

        pdfDoc.getPages()[sig.page - 1].drawImage(pngImage, {
          x: pdfX,
          y: pdfY,
          width: sig.displayW / pxPerPdfPointX,
          height: sig.displayH / pxPerPdfPointY,
        });
      }

      // ✅ Fix TypeScript: dùng .buffer thay vì cast
      const signedBytes = await pdfDoc.save();
      const blob = new Blob([signedBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "signed.pdf";
      a.click();
      URL.revokeObjectURL(url);

      message.success("Signed PDF downloaded");
    } catch (err) {
      console.error("Error applying signatures:", err);
      message.error("Failed to apply signatures.");
    }
  };

  /* ----------- Render ----------- */
  return (
    <div style={{ padding: 16 }}>
      <Row gutter={16}>
        {/* Left Panel */}
        <Col span={8}>
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text strong>1) Upload PDF</Text>
            <Upload
              beforeUpload={beforePdfUpload}
              accept="application/pdf"
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />}>Choose PDF</Button>
            </Upload>

            <Text strong style={{ marginTop: 12 }}>
              2) Draw / upload signature
            </Text>
            <canvas
              ref={sigCanvasRef}
              style={{
                border: "1px solid #ddd",
                width: "100%",
                cursor: "crosshair",
              }}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
            />
            <Space>
              <Button icon={<ClearOutlined />} onClick={clearSig}>
                Clear
              </Button>
              <Upload
                beforeUpload={beforeSigUpload}
                accept="image/*"
                showUploadList={false}
              >
                <Button icon={<PictureOutlined />}>Upload Image</Button>
              </Upload>
            </Space>

            <Text strong style={{ marginTop: 12 }}>
              3) Place signature
            </Text>
            <Text type="secondary">
              Click on a page preview (right), then drag/resize.
            </Text>

            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={applySignaturesAndDownload}
              disabled={!placedSignatures.length}
              style={{ marginTop: 12 }}
            >
              Apply & Download
            </Button>
          </Space>
        </Col>

        {/* Right Panel */}
        <Col span={16}>
          <Space align="center">
            <Text strong>Preview</Text>
            <Text type="secondary">Zoom</Text>
            <Slider
              min={0.6}
              max={2}
              step={0.1}
              value={scale}
              onChange={setScale}
              style={{ width: 200 }}
            />
          </Space>
          <div
            style={{
              border: "1px solid #eee",
              padding: 12,
              marginTop: 12,
              height: "75vh",
              overflow: "auto",
              position: "relative",
            }}
          >
            {!pdfArrayBuffer ? (
              <div style={{ padding: 32 }}>
                No PDF loaded. Please upload a file.
              </div>
            ) : (
              <Document
                file={pdfArrayBuffer}
                onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
                onLoadError={() => message.error("Failed to load PDF.")}
              >
                {Array.from({ length: numPages }, (_, i) => (
                  <div
                    key={i}
                    style={{ marginBottom: 16, position: "relative" }}
                  >
                    <div
                      ref={(el) => {
                        pageContainersRef.current[i + 1] = el;
                      }}
                      onClick={(e) => onPageClick(e, i + 1)}
                      style={{ display: "inline-block", position: "relative" }}
                    >
                      <Page
                        pageNumber={i + 1}
                        scale={scale}
                        renderAnnotationLayer={false}
                        renderTextLayer
                        onRenderSuccess={() => onPageRenderSuccess(i + 1)}
                      />
                      {placedSignatures
                        .filter((s) => s.page === i + 1)
                        .map((sig) => (
                          <Rnd
                            key={sig.id}
                            bounds="parent"
                            size={{ width: sig.displayW, height: sig.displayH }}
                            position={{ x: sig.displayX, y: sig.displayY }}
                            onDragStop={(e, d) =>
                              setPlacedSignatures((sigs) =>
                                sigs.map((s) =>
                                  s.id === sig.id
                                    ? { ...s, displayX: d.x, displayY: d.y }
                                    : s
                                )
                              )
                            }
                            onResizeStop={(e, dir, ref, delta, pos) =>
                              setPlacedSignatures((sigs) =>
                                sigs.map((s) =>
                                  s.id === sig.id
                                    ? {
                                        ...s,
                                        displayW: parseFloat(ref.style.width),
                                        displayH: parseFloat(ref.style.height),
                                        displayX: pos.x,
                                        displayY: pos.y,
                                      }
                                    : s
                                )
                              )
                            }
                          >
                            <img
                              src={sig.imgDataUrl}
                              alt="signature"
                              style={{ width: "100%", height: "100%" }}
                            />
                          </Rnd>
                        ))}
                    </div>
                  </div>
                ))}
              </Document>
            )}
          </div>
        </Col>
      </Row>
    </div>
  );
}
