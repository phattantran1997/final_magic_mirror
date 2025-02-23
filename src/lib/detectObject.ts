
import { DATA_CLASS, EXCLUDE_CLASSES_INDEXES } from "@/constants/classes";
import * as tf from "@tensorflow/tfjs";
import { renderBoxes } from "./boxRender";

export interface ModelConfig {
  modelPath: string;
  maxDetections?: number;
  iouThreshHold?: number;
  scoreThreshHold?: number;
  classes?: string[];
  inputHeight: number;
  inputWidth: number;
}

export class ObjectDetectionModel {
  private model: tf.GraphModel | null;
  public readonly config: Required<ModelConfig>;
  private detectedCount: Map<string, number> = new Map()
  private maxCount: number = 0;
  private onRate: (obName: string) => Promise<void>;
  // private onDetect: (classes: string[]) => void; // Added onDetect callback

  constructor(
    config: Required<ModelConfig>,
    maxCount: number = 20,
    callback: (obName: string) => Promise<void>,
  ) {
    this.config = config;
    this.model = null;
    this.maxCount = maxCount;
    this.onRate = callback;
  }

  private warmupModel(): void {
    const dummyInput = tf.ones(this.model!.inputs[0].shape!);
    this.model!.execute(dummyInput);
  }

  private reset(): void {
    for (const k of this.detectedCount.keys()) {
      this.detectedCount.set(k, 0)
    }
  }

  private rate(): string | null {
    const keys = Array.from(this.detectedCount.keys())
    const value = Array.from(this.detectedCount.values())
    if (Math.max(...value) > this.maxCount) {
      const maxIdx = tf.tensor(value).argMax()
      const idx = maxIdx.dataSync().at(0)!
      return keys[idx]
    }
    return null
  }

  private updateCount(obName: string) {
    obName = obName.toLowerCase()
    if (this.detectedCount.has(obName)) {
      const cls = this.detectedCount.get(obName)!
      this.detectedCount.set(obName, cls + 1)
    } else {
      this.detectedCount.set(obName, 1)
    }
  }


  public async loadModel(): Promise<void> {
    try {
      this.model = await tf.loadGraphModel(this.config.modelPath);
      this.warmupModel();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load model: ${errorMessage}`);
    }
  }

  private prepareInput(dataSource: HTMLVideoElement) {
    let ratioX: number = 1;
    let ratioY: number = 1;

    const inputData: tf.Tensor4D = tf.tidy(() => {
      const image = tf.browser.fromPixels(dataSource);

      const [h, w] = image.shape.slice(0, 2);

      const maxSize = Math.max(w, h);
      const imgPadded = image.pad([
        [0, maxSize - h],
        [0, maxSize - w],
        [0, 0],
      ]);

      ratioX = maxSize / w;
      ratioY = maxSize / h;

      // Add a batch dimension (rank-4 tensor) and flip left-right
      return tf.image
        .flipLeftRight(
          tf.image
            .resizeBilinear(imgPadded as tf.Tensor4D, [
              this.config.inputWidth,
              this.config.inputHeight,
            ])
            .div(255.0)
            .expandDims(0) as tf.Tensor4D // Add batch dimension here
        );
    });

    return [inputData, ratioX, ratioY];
  }

  public async detect(
    dataSource: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    callback: () => Promise<void>,
  ) {
    tf.engine().startScope();
    const [inputData, ratioX, ratioY] = this.prepareInput(dataSource);
    const prediction: tf.Tensor = this.model!.predict(inputData as tf.Tensor) as tf.Tensor;

    const result = prediction.squeeze();
    const transposed = result.transpose();

    const boxes = tf.tidy(() => {
      const centerX = transposed.slice([0, 0], [-1, 1]);
      const centerY = transposed.slice([0, 1], [-1, 1]);
      const w = transposed.slice([0, 2], [-1, 1]);
      const h = transposed.slice([0, 3], [-1, 1]);

      const x1 = tf.sub(centerX, tf.div(w, 2));
      const y1 = tf.sub(centerY, tf.div(h, 2));
      const x2 = tf.add(x1, w);
      const y2 = tf.add(y1, h);

      return tf.concat([x1, y1, x2, y2], 1);
    });

    const [scores, classes] = tf.tidy(() => {
      const rawScores = transposed.slice([0, 4], [-1, this.config.classes.length]).squeeze();
      return [rawScores.max(1), rawScores.argMax(1)];
    });

    const nms = await tf.image.nonMaxSuppressionAsync(
      boxes as tf.Tensor2D,
      scores,
      this.config.maxDetections,
      this.config.iouThreshHold,
      this.config.scoreThreshHold,
    );

    const classesRaw = classes.gather(nms, 0);
    const mask = tf
      .tensor1d(EXCLUDE_CLASSES_INDEXES, 'int32')
      .equal(classesRaw.reshape([-1, 1]))
      .any(1)
      .logicalNot();

    const filteredClasses = await tf.booleanMaskAsync(classesRaw, mask);
    const indices = await tf.whereAsync(mask);

    const boxesData = boxes.gather(nms, 0).gather(indices, 0).dataSync();
    const classesData = filteredClasses.dataSync();
    const scoresData = scores.gather(nms, 0).gather(indices, 0).dataSync();

    if (scoresData.length > 0) {
      const highestScore = tf.topk(scoresData, 1);
      const highestScoreIdx = highestScore.indices;
      const highestClass = classesData[highestScoreIdx.dataSync()[0]];
      this.updateCount(DATA_CLASS[highestClass]);
    }

    renderBoxes(canvas, boxesData as Float32Array, scoresData, Array.from(classesData), [ratioX as number, ratioY as number]);

    tf.dispose([prediction, transposed, boxes, scores, classes, nms]);

    callback();

    tf.engine().endScope();
  }

  public async detectVideoFrame(
    source: HTMLVideoElement,
    canvas: HTMLCanvasElement
  ) {

    const detectSingleFrame = async () => {
      console.log(source.videoWidth === 0, source.srcObject === null)
      // Ensure video dimensions are valid before proceeding
      if (source.videoWidth === 0 || source.srcObject === null) {
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        return;
      }

      // If a rate condition is met, execute callback and reset detection
      if (this.rate()) {
        const ctx = canvas.getContext("2d")!;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        await this.onRate(this.rate()!); // Handle detected object callback
        this.reset(); // Reset detection counts
        return;
      }

      // Perform object detection on the current frame
      await this.detect(
        source,
        canvas,
        async () => {
          requestAnimationFrame(detectSingleFrame); // Continue to the next frame
        },
      );
    };

    // Start processing frames
    await detectSingleFrame();
  }

}
