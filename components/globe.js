import { useEffect, useState } from "react";
import { Cloud, fetchSimpleIcons, renderSimpleIcon } from "react-icon-cloud";

const cloudProps = {
  containerProps: {
    style: {
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      width: "100%",
      paddingTop: 40,
    },
  },
  options: {
    reverse: true,
    depth: 1,
    wheelZoom: false,
    imageScale: 2,
    activeCursor: "default",
    tooltip: "native",
    initial: [0.1, -0.1],
    clickToFront: 500,
    tooltipDelay: 0,
    outlineColour: "#0000",
    maxSpeed: 0.04,
    minSpeed: 0.02,
    wheelZoom: true,
  },
};

const useIcons = (slugs) => {
  const [icons, setIcons] = useState();
  useEffect(() => {
    fetchSimpleIcons({ slugs }).then(setIcons);
  }, []);
  const bgHex = "#f3f2ef"; // Light theme background color
  const fallbackHex = "#6e6e73"; // Light theme fallback color
  const minContrastRatio = 1.2;

  if (icons) {
    return Object.values(icons.simpleIcons).map((icon) =>
      renderSimpleIcon({
        icon,
        bgHex,
        fallbackHex,
        minContrastRatio,
        size: 42,
        aProps: {
          href: undefined,
          target: undefined,
          rel: undefined,
          onClick: (e) => e.preventDefault(),
        },
      })
    );
  }

  return <a>Loading</a>;
};

export const IconCloud = ({ iconSlugs }) => {
  const icons = useIcons(iconSlugs);

  return (
    <Cloud {...cloudProps}>
      <>{icons}</>
    </Cloud>
  );
};
