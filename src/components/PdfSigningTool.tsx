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

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

const { Text } = Typography;

type PlacedSignature = {
  id: string;
  page: number; // 1-based
  x: number; // PDF points
  y: number; // PDF points
  width: number; // PDF points
  height: number; // PDF points
  imgDataUrl: string; // PNG data URL
  displayX?: number; // px relative to page container
  displayY?: number;
  displayW?: number;
  displayH?: number;
};

export default function PdfSigningTool() {
  const [pdfArrayBuffer, setPdfArrayBuffer] = useState<ArrayBuffer | null>(
    null
  );
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState<number>(1.2);
  const [placedSignatures, setPlacedSignatures] = useState<PlacedSignature[]>(
    []
  );

  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sigDrawing = useRef(false);

  const pageContainersRef = useRef<Record<number, HTMLDivElement | null>>({});
  const pageViewportSizes = useRef<
    Record<
      number,
      { width: number; height: number; pdfWidth: number; pdfHeight: number }
    >
  >({});

  const pdfLibDocRef = useRef<PDFDocument | null>(null);

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

  function startDraw(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    sigDrawing.current = true;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function draw(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!sigDrawing.current) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  function endDraw() {
    sigDrawing.current = false;
  }
  function clearSig() {
    const c = sigCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
  }

  const beforePdfUpload = async (file: File) => {
    const arrayBuffer = await file.arrayBuffer();
    setPdfArrayBuffer(arrayBuffer);
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    pdfLibDocRef.current = pdfDoc;
    setNumPages(pdfDoc.getPageCount());
    message.success(`${file.name} loaded`);
    return false;
  };

  async function onPageRenderSuccess(pageIndex: number) {
    const container = pageContainersRef.current[pageIndex];
    if (!container || !pdfLibDocRef.current) return;
    const page = pdfLibDocRef.current.getPage(pageIndex - 1);
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    const rect = container.getBoundingClientRect();
    pageViewportSizes.current[pageIndex] = {
      width: rect.width,
      height: rect.height,
      pdfWidth,
      pdfHeight,
    };
  }

  async function onPageClick(
    e: React.MouseEvent<HTMLDivElement>,
    pageNumber: number
  ) {
    const container = pageContainersRef.current[pageNumber];
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const viewport = pageViewportSizes.current[pageNumber];
    if (!viewport) return;
    const canvas = sigCanvasRef.current;
    if (!canvas) {
      message.warning("Draw or upload a signature first");
      return;
    }
    const dataUrl = canvas.toDataURL("image/png");
    const desiredDisplayedSigWidth = viewport.width * 0.3;
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const aspect = img.height / img.width;
      const displayW = desiredDisplayedSigWidth;
      const displayH = displayW * aspect;
      const displayX = clickX - displayW / 2;
      const displayY = clickY - displayH / 2;
      const newSig: PlacedSignature = {
        id: `${Date.now()}_${Math.random()}`,
        page: pageNumber,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        imgDataUrl: dataUrl,
        displayX,
        displayY,
        displayW,
        displayH,
      };
      setPlacedSignatures((s) => [...s, newSig]);
      message.success("Signature placed, drag/resize to adjust.");
    };
  }

  async function applySignaturesAndDownload() {
    if (!pdfLibDocRef.current || !pdfArrayBuffer) {
      message.warning("Load a PDF first");
      return;
    }
    const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
    for (const sig of placedSignatures) {
      const viewport = pageViewportSizes.current[sig.page];
      if (!viewport) continue;
      const pxPerPdfPointX = viewport.width / viewport.pdfWidth;
      const pxPerPdfPointY = viewport.height / viewport.pdfHeight;
      const pdfX = sig.displayX! / pxPerPdfPointX;
      const pdfY =
        (viewport.height - (sig.displayY! + sig.displayH!)) / pxPerPdfPointY;
      const pdfW = sig.displayW! / pxPerPdfPointX;
      const pdfH = sig.displayH! / pxPerPdfPointY;

      const pngImageBytes = dataURLtoUint8Array(sig.imgDataUrl);
      const pngImage = await pdfDoc.embedPng(pngImageBytes);
      const page = pdfDoc.getPages()[sig.page - 1];
      page.drawImage(pngImage, { x: pdfX, y: pdfY, width: pdfW, height: pdfH });
    }
    const signedBytes = await pdfDoc.save();
    const blob = new Blob([new Uint8Array(signedBytes)], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signed.pdf";
    a.click();
    URL.revokeObjectURL(url);
    message.success("Signed PDF downloaded");
  }

  function dataURLtoUint8Array(dataURL: string) {
    const base64 = dataURL.split(",")[1];
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
    return bytes;
  }

  const beforeSigUpload = async (file: File) => {
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
      let w = img.width;
      let h = img.height;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w *= ratio;
      h *= ratio;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    message.success("Signature image loaded into pad");
    return false;
  };

  function fileToDataUrl(file: File) {
    return new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result as string);
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
  }

  return (
    <div style={{ padding: 16 }}>
      <Row gutter={16}>
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
              onMouseDown={(e) => startDraw(e)}
              onMouseMove={(e) => draw(e)}
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
              Click on a page preview (right), then drag/resize the signature
              box.
            </Text>

            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={applySignaturesAndDownload}
                disabled={placedSignatures.length === 0}
              >
                Apply signatures & Download
              </Button>
            </div>
          </Space>
        </Col>
        <Col span={16}>
          <div>
            <Space align="center">
              <Text strong>Preview</Text>
              <Text type="secondary">Zoom</Text>
              <Slider
                min={0.6}
                max={2}
                step={0.1}
                value={scale}
                onChange={(v) => setScale(v)}
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
              {!pdfArrayBuffer && (
                <div style={{ padding: 32 }}>No PDF loaded</div>
              )}
              {pdfArrayBuffer && (
                <Document
                  file={pdfArrayBuffer}
                  onLoadSuccess={(d) => setNumPages(d.numPages)}
                >
                  {Array.from(new Array(numPages), (el, index) => (
                    <div
                      key={`page_${index + 1}`}
                      style={{ marginBottom: 16, position: "relative" }}
                    >
                      <div
                        ref={(el) => {
                          pageContainersRef.current[index + 1] = el;
                        }}
                        onClick={(e) => onPageClick(e, index + 1)}
                        style={{
                          display: "inline-block",
                          position: "relative",
                        }}
                      >
                        <Page
                          pageNumber={index + 1}
                          scale={scale}
                          renderAnnotationLayer={false}
                          renderTextLayer={true}
                          onRenderSuccess={() => onPageRenderSuccess(index + 1)}
                        />
                        {placedSignatures
                          .filter((s) => s.page === index + 1)
                          .map((sig) => (
                            <Rnd
                              key={sig.id}
                              bounds="parent"
                              size={{
                                width: sig.displayW!,
                                height: sig.displayH!,
                              }}
                              position={{ x: sig.displayX!, y: sig.displayY! }}
                              onDragStop={(e, d) => {
                                setPlacedSignatures((sigs) =>
                                  sigs.map((s) =>
                                    s.id === sig.id
                                      ? { ...s, displayX: d.x, displayY: d.y }
                                      : s
                                  )
                                );
                              }}
                              onResizeStop={(e, dir, ref, delta, pos) => {
                                setPlacedSignatures((sigs) =>
                                  sigs.map((s) =>
                                    s.id === sig.id
                                      ? {
                                          ...s,
                                          displayW: parseFloat(ref.style.width),
                                          displayH: parseFloat(
                                            ref.style.height
                                          ),
                                          displayX: pos.x,
                                          displayY: pos.y,
                                        }
                                      : s
                                  )
                                );
                              }}
                            >
                              <img
                                src={sig.imgDataUrl}
                                alt="signature"
                                style={{
                                  width: "100%",
                                  height: "100%",
                                  pointerEvents: "none",
                                }}
                              />
                            </Rnd>
                          ))}
                      </div>
                    </div>
                  ))}
                </Document>
              )}
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
}
