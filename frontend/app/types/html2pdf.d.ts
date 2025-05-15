declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | [number, number, number, number];
    filename?: string;
    image?: {
      type?: string;
      quality?: number;
    };
    html2canvas?: {
      scale?: number;
      useCORS?: boolean;
      [key: string]: any;
    };
    jsPDF?: {
      unit?: string;
      format?: string;
      orientation?: 'portrait' | 'landscape';
      [key: string]: any;
    };
    [key: string]: any;
  }

  interface Html2PdfInterface {
    set(options: Html2PdfOptions): Html2PdfInterface;
    from(element: HTMLElement | string): Html2PdfInterface;
    save(): Promise<void>;
    output(type: string, options?: any): Promise<any>;
    then(callback: Function): Html2PdfInterface;
    catch(callback: Function): Html2PdfInterface;
  }

  function html2pdf(): Html2PdfInterface;
  function html2pdf(element: HTMLElement | string, options?: Html2PdfOptions): Html2PdfInterface;

  export default html2pdf;
} 