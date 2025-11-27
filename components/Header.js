import React, { useState } from "react";
import { useTheme } from "./utils/ThemeProvider";
import Link from "next/link";

const Header = () => {
  const [Toggle, showMenu] = useState(false);
  const { theme, toggleTheme } = useTheme();
  return (
  <header className="header dark:bg-gray-900 dark:text-white" id="header">
    <nav className="nav container_mod">
      <a
        href="#"
        className="nav__logo text-purple-600 dark:text-gray-100 transition-colors duration-300"
        style={{ fontFamily: "Allison" }}
      >
        Ravi Kishan
      </a>

        <div
          className={Toggle ? "nav__menu show-menu dark:bg-transparent" : "nav__menu dark:bg-transparent"}
          id="nav-menu"
        >
          <ul className="nav__list grid_mod dark:text-white ">
            <li className="nav__item">
              <Link href="/">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                  <i className="uil uil-estate nav__icon"></i>Home
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/about" className="nav__link">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                  <i className="uil uil-user nav__icon"></i>About
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/skills">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                  <i className="uil uil-file-alt nav__icon"></i>Skills
                </span>
              </Link>
            </li>
            <li className="nav__item">
              <Link href="/resume">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                  <i className="uil uil-briefcase-alt nav__icon"></i>Resume
                </span>
              </Link>
            </li>
             <li className="nav__item">
              <Link href="/projects">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                <i className="uil uil-scenery nav__icon"></i>Projects
                </span>
              </Link>
            </li>
            <li className="nav__item ">
              <Link href="/contact">
                <span className="nav__link dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300">
                <i className="uil uil-message nav__icon"></i>Contact
                </span>
              </Link>
            </li>
            
          </ul>
          <i
            className="uil uil-times nav__close dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300"
            id="nav-close"
            onClick={() => showMenu(!Toggle)}
          ></i>
        </div>
        <div className="nav__btns">
          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="theme-toggle"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "🌙" : "☀️"}
          </button>
          <div
            className="nav__toggle dark:text-white text-gray-700 hover:text-purple-600 dark:hover:text-purple-400 transition-colors duration-300"
            id="nav-toggle"
            onClick={() => showMenu(!Toggle)}
          >
            <i className="uil uil-apps"></i>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;
