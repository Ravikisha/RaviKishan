import React from "react";
import Link from 'next/link';

const Social = () => {
  return (
    <>
      <div className="home__social">
        <Link href="https://www.instagram.com/ravikishan.404/" passHref={true}>
        <a
          target="_blank"
          // rel="noopener noreferrer"
          className="home__social-icon text-gray-600 dark:text-purple-400 hover:text-purple-600 dark:hover:text-purple-300 transition-all duration-300"
          >
          <i className="uil uil-instagram"></i>
        </a>
          </Link>
          < Link href="https://github.com/ravikisha"><a
          
          target="_blank"
          // rel="noopener noreferrer"
          className="home__social-icon text-gray-600 dark:text-purple-400 hover:text-purple-600 dark:hover:text-purple-300 transition-all duration-300"
        >
          <i className="uil uil-github-alt"></i>
        </a>
        </Link>
        <Link href="https://www.linkedin.com/in/ravi-kishan-62ab51221/" >
        <a
          target="_blank"
          rel="noopener noreferrer"
          className="home__social-icon text-gray-600 dark:text-purple-400 hover:text-purple-600 dark:hover:text-purple-300 transition-all duration-300"
        >
          <i className="uil uil-linkedin"></i>
        </a>
        </Link>
      </div>
    </>
  );
};

export default Social;
