import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  server: {
    host: true,
    // getUserMedia needs a secure context. localhost counts as one; if you want to
    // test from a phone on the LAN, run `vite --https` or tunnel it.
  },
  build: {
    target: "es2022",
  },
});
