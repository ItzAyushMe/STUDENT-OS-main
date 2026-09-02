// Pixel-font text — gamer mode headings, XP numbers, banners.
import { Text } from 'react-native';
import { GAMER, fonts } from '../../config/theme';

export function PixelText({ children, size = 10, color, glow, align, style, numberOfLines }) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={{
        fontFamily: fonts.pixel,
        fontSize: size,
        lineHeight: size * 2,
        letterSpacing: 0.5,
        color: color || GAMER.text,
        textAlign: align,
        ...(glow
          ? {
              textShadowColor: color || GAMER.primarySoft,
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 9,
            }
          : {}),
        ...style,
      }}
    >
      {children}
    </Text>
  );
}
