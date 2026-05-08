import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
    },
  });

  const PORT = 3000;

  // In-memory store for recent commits
  const recentCommits: any[] = [];
  const MAX_COMMITS = 50;

  io.on("connection", (socket) => {
    console.log("A user connected:", socket.id);

    // Send existing commits to newly connected user
    socket.emit("initial:commits", recentCommits);

    socket.on("commit:create", (commit) => {
      const newCommit = {
        ...commit,
        id: Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
      };
      
      recentCommits.unshift(newCommit);
      if (recentCommits.length > MAX_COMMITS) {
        recentCommits.pop();
      }

      // Broadcast to everyone including sender
      io.emit("commit:broadcast", newCommit);
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
