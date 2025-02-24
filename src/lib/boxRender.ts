import { DATA_CLASS } from "@/constants/classes";

const labels: string[] = DATA_CLASS;

const MIN_AREA_THRESHOLD = 15000; // Adjust this value as needed for your use case

export const renderBoxes = (
  canvasRef: HTMLCanvasElement,
  boxesData: Float32Array,
  scoresData: number[],
  classesData: number[],
  displayRatios: number[]
) => {
  const ctx = canvasRef.getContext("2d")!;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); // Clear the canvas

  const colors = new Colors();

  const font = `${Math.max(
    Math.round(Math.max(ctx.canvas.width, ctx.canvas.height) / 40),
    14
  )}px Arial`;
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.filter = "none";

  const FRAME_AREA = ctx.canvas.width * ctx.canvas.height; // Total area of the frame
  const NEAR_OBJECT_AREA_THRESHOLD = FRAME_AREA * 0.05; // 5% of the frame area (adjust as needed)

  const filteredBoxes = []; // To store filtered boxes with associated data
  for (let i = 0; i < scoresData.length; ++i) {
    let [x1, y1, x2, y2] = boxesData.slice(i * 4, (i + 1) * 4);
    x1 *= displayRatios[0];
    x2 *= displayRatios[0];
    y1 *= displayRatios[1];
    y2 *= displayRatios[1];
    const width = x2 - x1;
    const height = y2 - y1;
    const boxArea = width * height;

    console.log(`Object ${i}: Area = ${boxArea}`); // Debugging: Log the area of each bounding box

    // Filter boxes based on area (only detect near objects)
    if (boxArea > NEAR_OBJECT_AREA_THRESHOLD) {
      filteredBoxes.push({ x1, y1, x2, y2, width, height, klass: DATA_CLASS[classesData[i]], score: scoresData[i], color: colors.get(classesData[i]) });
    }
  }

  // Render only the filtered boxes
  for (const box of filteredBoxes) {
    const { x1, y1, width, height, klass, score, color } = box;

    // Draw bounding box
    ctx.fillStyle = Colors.hexToRgba(color, 0.2) as string;
    ctx.fillRect(x1, y1, width, height);

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(Math.min(ctx.canvas.width, ctx.canvas.height) / 200, 2.5);
    ctx.strokeRect(x1, y1, width, height);

    // Draw label background and text
    ctx.fillStyle = color;
    const text = `${klass} - ${(score * 100).toFixed(1)}%`;
    const textWidth = ctx.measureText(text).width;
    const textHeight = parseInt(font, 10);
    const yText = y1 - (textHeight + ctx.lineWidth);
    ctx.fillRect(
      x1 - 1,
      yText < 0 ? 0 : yText, // Prevents text overflow
      textWidth + ctx.lineWidth,
      textHeight + ctx.lineWidth
    );

    // Draw text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, x1 - 1, yText < 0 ? 0 : yText);
  }
};

class Colors {

  palette: string[]
  n: number

  constructor() {
    this.palette = [
      "#FF3838",
      "#FF9D97",
      "#FF701F",
      "#FFB21D",
      "#CFD231",
      "#48F90A",
      "#92CC17",
      "#3DDB86",
      "#1A9334",
      "#00D4BB",
      "#2C99A8",
      "#00C2FF",
      "#344593",
      "#6473FF",
      "#0018EC",
      "#8438FF",
      "#520085",
      "#CB38FF",
      "#FF95C8",
      "#FF37C7",
    ];
    this.n = this.palette.length;
  }

  get = (i: number) => this.palette[Math.floor(i) % this.n];

  static hexToRgba = (hex: string, alpha: number): string | null => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? `rgba(${[parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)].join(
        ", "
      )}, ${alpha})`
      : null;
  };
}
