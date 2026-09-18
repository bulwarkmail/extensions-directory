/**
 * Seed example plugins and themes from repos/plugins/ and repos/themes/
 * into the extension directory database.
 *
 * Usage:
 *   npx tsx scripts/seed-extensions.ts
 *
 * Run from the extension-directory root.
 * Requires DATABASE_PATH and UPLOADS_DIR to be set (or .env).
 */

import "dotenv/config";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import {
  authors,
  extensions,
  extensionVersions,
} from "../lib/db/schema";
import JSZip from "jszip";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const dbPath =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), "data", "extensions.db");
const uploadsDir =
  process.env.UPLOADS_DIR || path.join(process.cwd(), "data", "uploads");

const PLUGINS_DIR = path.resolve(process.cwd(), "..", "plugins");
const THEMES_DIR = path.resolve(process.cwd(), "..", "themes");

interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  type: string;
  permissions?: string[];
  entrypoint?: string;
  minAppVersion?: string;
  settingsSchema?: Record<string, unknown>;
  variants?: string[];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function createZipBundle(
  rootDir: string,
  filenames: string[]
): Promise<Buffer> {
  const zip = new JSZip();

  for (const filename of filenames) {
    zip.file(filename, fs.readFileSync(path.join(rootDir, filename)));
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

async function main() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite);

  // Ensure a community author
  const COMMUNITY_AUTHOR = "Bulwark Mail Community";
  const COMMUNITY_GITHUB_ID = 999999;
  const COMMUNITY_LOGIN = "bulwarkmail";

  let authorRow = (
    await db
      .select()
      .from(authors)
      .where(eq(authors.githubId, COMMUNITY_GITHUB_ID))
      .limit(1)
  )[0];

  if (!authorRow) {
    const result = await db
      .insert(authors)
      .values({
        githubId: COMMUNITY_GITHUB_ID,
        githubLogin: COMMUNITY_LOGIN,
        displayName: COMMUNITY_AUTHOR,
        avatarUrl: "https://github.com/bulwarkmail.png",
        verified: true,
        banned: false,
      })
      .returning();
    authorRow = result[0];
    console.log(`✓ Created author: ${COMMUNITY_AUTHOR}`);
  } else {
    console.log(`  Author already exists: ${COMMUNITY_AUTHOR}`);
  }

  const authorId = authorRow.id;

  // Discover plugins
  const pluginDirs = fs.existsSync(PLUGINS_DIR)
    ? fs
        .readdirSync(PLUGINS_DIR, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !d.name.startsWith(".") &&
            d.name !== "node_modules" &&
            d.name !== "plugin-template"
        )
        .map((d) => d.name)
    : [];

  // Discover themes
  const themeDirs = fs.existsSync(THEMES_DIR)
    ? fs
        .readdirSync(THEMES_DIR, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            !d.name.startsWith(".") &&
            d.name !== "node_modules" &&
            d.name !== "theme-template"
        )
        .map((d) => d.name)
    : [];

  console.log(
    `Found ${pluginDirs.length} plugins and ${themeDirs.length} themes\n`
  );

  // Tags for semantic categorization
  const pluginTags: Record<string, string[]> = {
    "hello-world": ["example", "starter"],
    "send-later": ["productivity", "email", "scheduling"],
    "quick-notes": ["productivity", "notes", "sidebar"],
    "email-stats": ["analytics", "sidebar", "statistics"],
    "auto-tag": ["automation", "email", "tagging"],
  };

  const themeTags: Record<string, string[]> = {
    dracula: ["dark", "popular", "purple"],
    "rose-pine": ["dark", "pastel", "aesthetic"],
    gruvbox: ["retro", "warm", "orange"],
    "tokyo-night": ["dark", "blue", "clean"],
  };

  const longDescriptions: Record<string, string> = {
    "hello-world":
      "A minimal example plugin demonstrating the BulwarkMail plugin API. Shows lifecycle hooks (activate/deactivate), event subscriptions (onAppReady, onEmailOpen, onNewEmailReceived), plugin storage, and toast notifications. Perfect starting point for plugin developers.",
    "send-later":
      "Adds a 'Send Later' button to the email composer toolbar with configurable scheduling delays. Supports keyboard shortcuts, configurable default delay times, and confirmation toasts. A great example of a UI extension plugin.",
    "quick-notes":
      "A sidebar widget that lets you attach sticky notes to individual emails. Notes persist across sessions using plugin storage. Also provides an email banner indicating when a note is attached. Useful for keeping track of thoughts and context while reading emails.",
    "email-stats":
      "A sidebar widget that tracks your email activity during the current session. Counts emails opened, sent, and provides a live activity feed. Configurable tracking options for opens and sends.",
    "auto-tag":
      "Automatically tags incoming emails based on configurable rules. Detects newsletters (via List-Unsubscribe header), invoices (keyword matching), and GitHub notifications (by sender). Runs as a background hook with no UI overhead.",
    dracula:
      "A dark theme inspired by the beloved Dracula color scheme. Features rich purples, vibrant pinks, and soothing dark backgrounds. Includes both light and dark variants. The iconic Dracula palette brings a distinctive look to your email workflow.",
    "rose-pine":
      "Soho vibes for your email client. Rosé Pine features natural, muted colors with warm rosy accents. The dark variant uses deep, moody base colors while the light variant offers a warm, paper-like feel. Both variants are designed for extended reading comfort.",
    gruvbox:
      "A retro groove color scheme with warm earthy tones. Based on the popular Gruvbox palette, this theme features rich oranges, greens, and yellows against dark or light backgrounds. Perfect for those who prefer a warm, vintage feel.",
    "tokyo-night":
      "A clean dark theme inspired by Tokyo city lights at night. Features cool blues and muted purples against a deep dark background. The thoughtfully chosen colors reduce eye strain while maintaining excellent readability.",
  };

  // Seed plugins
  for (const dir of pluginDirs) {
    const manifestPath = path.join(PLUGINS_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.log(`  Skipping ${dir}: no manifest.json`);
      continue;
    }

    const manifest: PluginManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8")
    );
    const slug = slugify(manifest.id || dir);

    // Check if already exists
    const existing = await db
      .select()
      .from(extensions)
      .where(eq(extensions.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  Plugin "${manifest.name}" already exists, skipping`);
      continue;
    }

    // Find the ZIP file
    const zipName = `${dir}.zip`;
    const zipPath = path.join(PLUGINS_DIR, dir, zipName);
    if (!fs.existsSync(zipPath)) {
      console.log(`  Skipping ${dir}: no ${zipName}`);
      continue;
    }

    const zipData = fs.readFileSync(zipPath);
    const sha256 = crypto.createHash("sha256").update(zipData).digest("hex");

    // Store the bundle
    const bundleDir = path.join(uploadsDir, "bundles", slug, manifest.version);
    fs.mkdirSync(bundleDir, { recursive: true });
    const bundleFilename = `${slug}-${manifest.version}.zip`;
    fs.writeFileSync(path.join(bundleDir, bundleFilename), zipData);
    const bundlePath = `bundles/${slug}/${manifest.version}/${bundleFilename}`;

    // Determine pluginType
    const pluginType = manifest.type === "theme"
      ? null
      : (manifest.type as "hook" | "ui-extension" | "sidebar-app");

    // Insert extension
    const extResult = await db
      .insert(extensions)
      .values({
        slug,
        name: manifest.name,
        type: "plugin",
        pluginType,
        authorId: authorId,
        description: manifest.description,
        longDescription: longDescriptions[dir] || manifest.description,
        githubRepo: `https://github.com/bulwarkmail/plugins`,
        license: "MIT",
        status: "approved",
        featured: ["send-later", "quick-notes", "auto-tag"].includes(dir),
        permissions: manifest.permissions || [],
        tags: pluginTags[dir] || [],
        minAppVersion: manifest.minAppVersion || "1.0.0",
        totalDownloads: 0,
      })
      .returning();

    // Insert version
    await db.insert(extensionVersions).values({
      extensionId: extResult[0].id,
      version: manifest.version,
      changelog: "Initial release",
      bundlePath,
      bundleSha256: sha256,
      bundleSize: zipData.length,
      permissions: manifest.permissions || [],
      minAppVersion: manifest.minAppVersion || "1.0.0",
      manifest: manifest as unknown as Record<string, unknown>,
      scanStatus: "clean",
      reviewStatus: "approved",
      publishedAt: new Date(),
    });

    console.log(`✓ Seeded plugin: ${manifest.name} (${slug})`);
  }

  // Seed themes
  for (const dir of themeDirs) {
    const manifestPath = path.join(THEMES_DIR, dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.log(`  Skipping ${dir}: no manifest.json`);
      continue;
    }

    const manifest: PluginManifest = JSON.parse(
      fs.readFileSync(manifestPath, "utf-8")
    );
    const slug = slugify(manifest.id || dir);

    // Themes are distributed as ZIP archives containing the source files.
    const themeFiles = ["manifest.json", "theme.css", "README.md"].filter((f) =>
      fs.existsSync(path.join(THEMES_DIR, dir, f))
    );

    const bundleContent = await createZipBundle(path.join(THEMES_DIR, dir), themeFiles);

    const bundleDir = path.join(uploadsDir, "bundles", slug, manifest.version);
    fs.mkdirSync(bundleDir, { recursive: true });

    for (const f of themeFiles) {
      fs.copyFileSync(
        path.join(THEMES_DIR, dir, f),
        path.join(bundleDir, f)
      );
    }

    const bundleFilename = `${slug}-${manifest.version}.zip`;
    fs.writeFileSync(path.join(bundleDir, bundleFilename), bundleContent);
    const bundlePath = `bundles/${slug}/${manifest.version}/${bundleFilename}`;
    const sha256 = crypto.createHash("sha256").update(bundleContent).digest("hex");

    // Check if already exists after rebuilding the bundle so reruns repair bad ZIPs.
    const existing = await db
      .select()
      .from(extensions)
      .where(eq(extensions.slug, slug))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(extensionVersions)
        .set({
          bundlePath,
          bundleSha256: sha256,
          bundleSize: bundleContent.length,
          permissions: [],
          minAppVersion: manifest.minAppVersion || "1.0.0",
          manifest: manifest as unknown as Record<string, unknown>,
          scanStatus: "clean",
          reviewStatus: "approved",
          publishedAt: new Date(),
        })
        .where(
          and(
            eq(extensionVersions.extensionId, existing[0].id),
            eq(extensionVersions.version, manifest.version)
          )
        );

      console.log(`✓ Repaired theme bundle: ${manifest.name} (${slug})`);
      continue;
    }

    // Insert extension
    const extResult = await db
      .insert(extensions)
      .values({
        slug,
        name: manifest.name,
        type: "theme",
        pluginType: null,
        authorId: authorId,
        description: manifest.description,
        longDescription: longDescriptions[dir] || manifest.description,
        githubRepo: `https://github.com/bulwarkmail/themes`,
        license: "MIT",
        status: "approved",
        featured: ["dracula", "tokyo-night"].includes(dir),
        permissions: [],
        tags: themeTags[dir] || [],
        minAppVersion: manifest.minAppVersion || "1.0.0",
        totalDownloads: 0,
      })
      .returning();

    // Insert version
    await db.insert(extensionVersions).values({
      extensionId: extResult[0].id,
      version: manifest.version,
      changelog: "Initial release",
      bundlePath,
      bundleSha256: sha256,
      bundleSize: bundleContent.length,
      permissions: [],
      minAppVersion: manifest.minAppVersion || "1.0.0",
      manifest: manifest as unknown as Record<string, unknown>,
      scanStatus: "clean",
      reviewStatus: "approved",
      publishedAt: new Date(),
    });

    console.log(`✓ Seeded theme: ${manifest.name} (${slug})`);
  }

  console.log("\nDone!");
  sqlite.close();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
