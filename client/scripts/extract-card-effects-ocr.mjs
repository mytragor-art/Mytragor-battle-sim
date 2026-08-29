import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

const publicDir = path.resolve("public");
const catalogSource = await fs.readFile(path.join(publicDir, "cards", "cartas.js"), "utf8");
const cards = vm.runInNewContext(`${catalogSource}\n;CARD_DEFS`);
const worker = await createWorker("por");
const results = [];

for (const card of cards) {
	if (!card?.img) continue;
	const imagePath = path.join(publicDir, String(card.img).replace(/^\/+/, ""));
	try {
		const metadata = await sharp(imagePath).metadata();
		const width = Number(metadata.width || 0);
		const height = Number(metadata.height || 0);
		if (!width || !height) continue;
		const effectPanel = await sharp(imagePath)
			.extract({ left: Math.round(width * 0.06), top: Math.round(height * 0.7), width: Math.round(width * 0.88), height: Math.round(height * 0.22) })
			.grayscale()
			.normalize()
			.png()
			.toBuffer();
		const { data } = await worker.recognize(effectPanel);
		results.push({ name: card.name, img: card.img, text: String(data.text || "").trim() });
	} catch (error) {
		results.push({ name: card.name, img: card.img, error: String(error) });
	}
}

await worker.terminate();
await fs.writeFile("card-effects-ocr.json", `${JSON.stringify(results, null, 2)}\n`);
console.log(`OCR concluído: ${results.length} cartas em card-effects-ocr.json`);