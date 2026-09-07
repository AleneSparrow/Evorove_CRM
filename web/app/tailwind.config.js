/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#F7F1E4",
        ink: "#0B0B0D",
        coral: {
          DEFAULT: "#FF5A36",
          wash: "#FFE8E1",
          deep: "#C73618",
        },
        lime: {
          DEFAULT: "#C6FF00",
          wash: "#EEFF99",
          ink: "#4A4A00",
        },
        clay: "#9A8F83",
        mute: "#6B6459",
        line: "#E4DCCB",
        panel: "#FFFCF6",
      },
    },
  },
  plugins: [],
};
