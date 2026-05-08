import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif"]);
const DEFAULT_FOLDERS = ["allies", "spell", "equip", "envs", "chosens", "fragments", "trick"];

function parseArgs(argv) {
	const options = {
		publicRoot: "public",
		outputRoot: "public/publicadas",
		folders: [...DEFAULT_FOLDERS],
		width: 420,
		height: 580,
		quality: 82,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const [rawKey, inlineValue] = arg.slice(2).split("=");
		const nextValue = inlineValue ?? argv[index + 1];
		const consumeNext = inlineValue == null;
		switch (rawKey) {
			case "public-root":
				options.publicRoot = String(nextValue || options.publicRoot);
				if (consumeNext) index += 1;
				break;
			case "output-root":
				options.outputRoot = String(nextValue || options.outputRoot);
				if (consumeNext) index += 1;
				break;
			case "folders":
				options.folders = String(nextValue || "")
					.split(",")
					.map((value) => value.trim())
					.filter(Boolean);
				if (consumeNext) index += 1;
				break;
			case "width":
				options.width = Number(nextValue || options.width);
				if (consumeNext) index += 1;
				break;
			case "height":
				options.height = Number(nextValue || options.height);
				if (consumeNext) index += 1;
				break;
			case "quality":
				options.quality = Number(nextValue || options.quality);
				if (consumeNext) index += 1;
				break;
			case "help":
				console.log(`Uso:\n  npm run assets:thumbs -- --folders allies,spell,equip\n\nOpcoes:\n  --public-root <pasta>  Padrao: public\n  --output-root <pasta>  Padrao: public/publicadas\n  --folders <lista>      Pastas separadas por virgula\n  --width <px>           Padrao: 420\n  --height <px>          Padrao: 580\n  --quality <0-100>      Padrao: 82`);
				process.exit(0);
			default:
				throw new Error(`Argumento desconhecido: --${rawKey}`);
		}
	}

	return options;
}

async function collectFiles(rootDir) {
	const entries = await fs.readdir(rootDir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const fullPath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectFiles(fullPath));
			continue;
		}
		if (!entry.isFile()) continue;
		if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
		files.push(fullPath);
	}
	return files;
}

async function ensureDir(dirPath) {
	await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const publicRoot = path.resolve(process.cwd(), options.publicRoot);
	const outputRoot = path.resolve(process.cwd(), options.outputRoot);
	await ensureDir(outputRoot);

	let processed = 0;
	let originalBytes = 0;
	let thumbBytes = 0;

	for (const folder of options.folders) {
		const sourceDir = path.join(publicRoot, folder);
		let stats;
		try {
			stats = await fs.stat(sourceDir);
		} catch {
			continue;
		}
		if (!stats.isDirectory()) continue;

		const files = await collectFiles(sourceDir);
		for (const file of files) {
			const relativePath = path.relative(publicRoot, file);
			const parsed = path.parse(relativePath);
			const outputFile = path.join(outputRoot, parsed.dir, `${parsed.name}.thumb.webp`);
			await ensureDir(path.dirname(outputFile));

			const sourceStat = await fs.stat(file);
			originalBytes += sourceStat.size;

			await sharp(file)
				.resize({
					width: options.width,
					height: options.height,
					fit: "inside",
					withoutEnlargement: true,
				})
				.webp({ quality: options.quality })
				.toFile(outputFile);

			const thumbStat = await fs.stat(outputFile);
			thumbBytes += thumbStat.size;
			processed += 1;
			console.log(`[assets:thumbs] ${relativePath} -> ${path.relative(publicRoot, outputFile)}`);
		}
	}

	console.log("");
	console.log(`[assets:thumbs] Arquivos processados: ${processed}`);
	console.log(`[assets:thumbs] Originais: ${(originalBytes / 1024 / 1024).toFixed(2)} MB`);
	console.log(`[assets:thumbs] Miniaturas: ${(thumbBytes / 1024 / 1024).toFixed(2)} MB`);
	if (originalBytes > 0) {
		const reduction = 100 - (thumbBytes / originalBytes) * 100;
		console.log(`[assets:thumbs] Reducao: ${reduction.toFixed(2)}%`);
	}
}

main().catch((error) => {
	console.error(`[assets:thumbs] ${error.message}`);
	process.exit(1);
});