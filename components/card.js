import React, { useEffect, useRef } from "react";
import { motion } from "framer-motion";
// import Tilt from 'react-vanilla-tilt';
import VanillaTilt from "vanilla-tilt";
import Image from "next/image";
import Link from "next/link";

function Tilt(props) {
  const { options, ...rest } = props;
  const tilt = useRef(null);

  useEffect(() => {
    VanillaTilt.init(tilt.current, options);
  }, [options]);

  return <div ref={tilt} {...rest} />;
}

const Card = ({ PL }) => {
  /* 
  {
    reverse:           false,  // reverse the tilt direction
    max:               35,     // max tilt rotation (degrees)
    perspective:       1000,   // Transform perspective, the lower the more extreme the tilt gets.
    scale:             1,      // 2 = 200%, 1.5 = 150%, etc..
    speed:             300,    // Speed of the enter/exit transition
    transition:        true,   // Set a transition on enter/exit.
    axis:              null,   // What axis should be disabled. Can be X or Y.
    reset:             true,   // If the tilt effect has to be reset on exit.
    easing:            "cubic-bezier(.03,.98,.52,.99)",    // Easing on enter/exit.
    glare:             false,   // if it should have a "glare" effect
    "max-glare":       1,      // the maximum "glare" opacity (1 = 100%, 0.5 = 50%)
    "glare-prerender": false   // false = VanillaTilt creates the glare elements for you, otherwise
                               // you need to add .js-tilt-glare>.js-tilt-glare-inner by yourself
} */
  const options = {
    scale: 1.2,
    speed: 1000,
    max: 30,
    // glare: true,
    // "max-glare": 0.3,
    // "glare-prerender": false
  };
  return (
    <>
      <Tilt options={options}>
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          initial={{ opacity: 0, scale: 0 }}
          transition={{ duration: 0.3 }}
          exit={{ opacity: 0, scale: 0 }}
          layout
          className="card__box"
        >
          <h2 className="card__name">{PL.name}</h2>
          <Link href={PL.codelink}>
            <a className="card__buy" target="_blank">
              Read More
            </a>
          </Link>
          <div className="card__circle"></div>
          <div className="card__product">
            <Image
              width="300"
              height="150"
              objectFit="contain"
              src={PL.imageUrl}
              alt={PL.name}
            />
          </div>
        </motion.div>
      </Tilt>
    </>
  );
};

export default Card;
