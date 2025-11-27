import {Earth} from './../components/earth';
import ContactForm from './../components/contactForm';
import Head from 'next/head';
import { useTheme } from '../components/utils/ThemeProvider';

const Contact = () => {
    const { theme } = useTheme();
    
    return(
        <>
        <Head>
        <title>Contact Page</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
        <div className={`earth__container bg-white dark:bg-gray-900 transition-colors duration-300 ${theme === 'dark' ? 'dark-theme' : 'light-theme'}`}>
            <Earth />
            {/* <Water /> */}
            <ContactForm />
            </div>
        </>
    )
}
export default Contact