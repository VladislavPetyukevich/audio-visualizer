declare module 'colorthief' {
  type Color = [number, number, number];
  namespace ColorThief {
    export function getColor(imagePath: string): Color;
  }
  export default ColorThief;
}