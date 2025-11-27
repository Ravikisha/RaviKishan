import React, { useState, useEffect, useRef } from "react";

const Strength = () => {
  return (
    <>
      {/* <h2 className="text-2xl md:text-4xl font-bold text-center text-gray-800 mb-10 mt-10 ">
          Strength & <span className="text-sky-500">Weakness</span>
        </h2>
      <div className="strength">
        <div className="strength__strength_part">
        <h4 className="text-3xl font-bold text-white mb-3">
              Conference Objectives
            </h4>
            <p className="mb-8">
              <ol className="style_1">
                <li>
                  To identify and acknowledge pioneering and innovative efforts
                  in the area of Industry 4.0
                </li>
                <li>
                  To explore the association between Industry 4.0 & sustainable
                  business practices.
                </li>
                <li>
                  To discuss issues related to innovation, Industry 4.0,
                  sustainable business practices, organizational growth and
                  effectiveness.
                </li>
                <li>
                  To bring plethora of speakers, academicians, researchers,
                  management thinkers, and businessman at one platform.
                </li>
                <li>
                  To motivate, recognize, appreciate and guide the budding
                  researchers and contribute towards the pool of research and
                  benefit the society.
                </li>
              </ol>
            </p>
        </div>
        <div className="strength__weak_part">
        <h4 className="text-3xl text-gray-800 font-bold mb-3">
              Conference Objectives
            </h4>
            <p className="mb-8">
              <ol className="style_1">
                <li>
                  To identify and acknowledge pioneering and innovative efforts
                  in the area of Industry 4.0
                </li>
                <li>
                  To explore the association between Industry 4.0 & sustainable
                  business practices.
                </li>
                <li>
                  To discuss issues related to innovation, Industry 4.0,
                  sustainable business practices, organizational growth and
                  effectiveness.
                </li>
                <li>
                  To bring plethora of speakers, academicians, researchers,
                  management thinkers, and businessman at one platform.
                </li>
                <li>
                  To motivate, recognize, appreciate and guide the budding
                  researchers and contribute towards the pool of research and
                  benefit the society.
                </li>
              </ol>
            </p>
          </div>
        </div> */}

      <div
        className="container min-h-2/3 max-w-screen-xl mx-auto py-10 px-7 md:px-16 bg-white dark:bg-gray-900 transition-colors duration-300"
        id="overview"
        data-aos="fade-down"
      >
        <h2 className="text-5xl font-bold text-center text-gray-800 dark:text-gray-100 mb-10 transition-colors duration-300">
          Strength & <span className="text-sky-500 dark:text-purple-400">Weakness</span>
        </h2>
        <div className="flex items-center flex-wrap mb-20 relatve">
          <div className="w-full md:w-1/2 p-5 bg-black dark:bg-gray-800 text-white dark:text-gray-100 h-full flex justify-center flex-col relative transition-colors duration-300" data-aos="flip-left" data-aos-delay="100">
            <h4 className="text-2xl md:text-3xl text-white font-bold mb-3">
              Strength
            </h4>
            <div className="mb-8 text-sm md:text-md">
              <ol className="style_1">
                <li>
                  <h2 className="text-white text-xl font-bold mb-2">
                    Collaborative
                  </h2>
                  I am very collaborative. I&apos;ve always enjoyed working on
                  teams and it is one of my strongest attributes. I led many
                  project that involve different kinds of people and I always
                  try to make sure that everyone is on the same page and that
                  everyone is happy with the work that they are doing.
                </li>
                <li>
                  <h2 className="text-white text-xl font-bold mb-2">
                    Technical Skills
                  </h2>
                  I am very technical. I have a lot of experience with different
                  technologies and I am always learning new ones. I am very
                  comfortable with the technologies that I use and I am always
                  looking for new ways to improve my skills.
                </li>
                <li>
                  <h2 className="text-white text-xl font-bold mb-2">
                    Postive Attitude
                  </h2>
                  I am very positive. I always try to see the good in every bad
                  situation and I always try to find a way to make things
                  better. I am always looking for ways to improve myself and I
                  am always looking for ways to make things better.
                </li>
                <li>
                  <h2 className="text-white text-xl font-bold mb-2">
                    Solving Problems
                  </h2>
                  I am very good at solving problems. I have a strategic mind
                  and simplicity on solving problems. If i can&apos;t find the
                  solution, I relax and continue to think about it. I always get
                  the solution.
                </li>
                <li>
                  <h2 className="text-white text-xl font-bold mb-2">
                    Flexibility
                  </h2>
                  I am very flexible. I have so many skills and always trying to
                  learn something new. I am so flexible to work with many job
                  profile. I&apos;m able to handle changes.
                </li>
              </ol>
            </div>
          </div>

          <div className="w-full md:w-1/2 p-5 h-full flex justify-center flex-col relative bg-gray-50 dark:bg-gray-700 transition-colors duration-300" data-aos="flip-right" data-aos-delay="150">
            <h4 className="text-2xl md:text-3xl text-gray-800 dark:text-gray-100 font-bold mb-3 transition-colors duration-300" >
              Weakness
            </h4>
            <div className="mb-8 text-sm md:text-md">
              <ol className="style_1">
                <li>
                  <h2 className="text-black dark:text-gray-100 text-xl font-bold mb-2 transition-colors duration-300">
                    Self-criticism
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
                  I can be quite critical of myself, which can lead to negative
                  self-talk and eventual burnout. I&apos;ve found that I can
                  avoid this by recording my goals, objectives, and key results
                  and setting aside time to celebrate milestones and
                  achievements, big and small.
                  </p>
                </li>
                <li>
                  <h2 className="text-black dark:text-gray-100 text-xl font-bold mb-2 transition-colors duration-300">
                    Procrastination
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
                  Procrastination has long been a bad habit of mine. I think it
                  stems from a fear of failure, to be honest. I started using
                  Google calendar and apps like Trello to manage my time better.
                  Crossing things off my to-do list makes me feel accomplished.
                  </p>
                </li>
                <li>
                  <h2 className="text-black dark:text-gray-100 text-xl font-bold mb-2 transition-colors duration-300">
                    Lack of experience with skill
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
                  I am not very experienced with some of the skills that I have
                  on my resume. I have been working on improving my experience
                  with these skills and I am confident that I will be able to
                  use them effectively in the future.
                  </p> 
                </li>
                <li>
                  <h2 className="text-black dark:text-gray-100 text-xl font-bold mb-2 transition-colors duration-300">
                    Issues with delegating tasks
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
                  I&apos;m a bit of a perfectionist, so I sometimes struggle to
                  delegate tasks to my teammates. This has led to taking on too
                  much. It was hard at first, but I&apos;ve seen that by
                  communicating clear expectations and trusting my team, they
                  rise to the occasion and I&apos;m able to manage projects more
                  efficiently.
                  </p>
                </li>
                <li>
                  <h2 className="text-black dark:text-gray-100 text-xl font-bold mb-2 transition-colors duration-300">
                    Fear of public speaking
                  </h2>
                  <p className="text-gray-700 dark:text-gray-300 transition-colors duration-300">
                  I am a naturally shy person. Since I was a kid, I have always
                  felt nervous presenting in front of the class and that
                  translated into the workplace.
                  </p>
                </li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Strength;
