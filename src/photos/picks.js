// Fotos elegidas a mano el 20 oct 2026 (sol 2013), mirando ~1200 miniaturas del feed de imágenes crudas
// de Mars 2020: solo color, sin cielo vacío, sol, calibración ni miniaturas. Orden: la más impresionante primero.
// Aquí solo viven los identificadores y un pie de foto: la foto, su cámara, su sol y su fecha se piden a la API
// de NASA cuando se hace clic en la cámara (ver catalog.js).

export const PICKS = {
  mastcam: [
    { id: "ZL0_2013_0845643031_659EBY_N0920000ZCAM10044_1100LMJ", note: "Rocas sobre arena, a pocos metros de Percy" },
    { id: "ZL0_2011_0845479463_916EBY_N0920000ZCAM05066_0340LMJ", note: "La torreta del brazo sobre el suelo marciano" },
    { id: "ZL0_2012_0845557275_785EBY_N0920000ZCAM04490_1100LMJ", note: "Rocas claras y oscuras sobre el suelo" },
    { id: "ZL0_2012_0845557079_523EBY_N0920000ZCAM04489_1100LMJ", note: "Una roca con un círculo claro en la superficie" },
    { id: "ZL0_2011_0845479420_619EBY_N0920000ZCAM05065_0480LMJ", note: "Herramientas del brazo con el horizonte de fondo" },
    { id: "ZL0_2013_0845643184_098EBY_N0920000ZCAM10045_1100LMJ", note: "Superficie de una roca, con vetas blancas" },
    { id: "ZL0_2012_0845557363_864EBY_N0920000ZCAM04491_1100LMJ", note: "Campo de rocas planas y una roca grande" },
    { id: "ZL0_2011_0845466223_928EBY_N0920000ZCAM10043_1100LMJ", note: "Roca con vetas blancas junto a otra más oscura" },
  ],
  navcam: [
    { id: "NLF_2011_0845478216_410ECM_N0920000NCAM00347_01_195J", note: "El brazo extendido sobre el suelo" },
    { id: "NLF_2010_0845369992_991ECM_N0920000NCAM13009_01_195J", note: "Una colina en el horizonte y la cubierta de Percy" },
    { id: "NLF_2011_0845478854_034ECM_N0920000NCAM00709_04_095J", note: "La sombra del brazo sobre una roca clara" },
    { id: "NLF_2008_0845208558_034ECM_N0911496NCAM00347_01_195J", note: "El brazo sobre el suelo, con huellas de ruedas" },
    { id: "NLF_2009_0845300355_355ECM_N0920000NCAM03009_10_195J", note: "Dos rocas grandes junto al rover" },
    { id: "NLF_2010_0845369992_991ECM_N0920000NCAM13009_04_195J", note: "Una cresta en el horizonte y la cubierta del rover" },
    { id: "NLF_2009_0845300490_318ECM_N0920000NCAM03009_04_195J", note: "El paisaje hasta el horizonte" },
  ],
  hazcam: [
    { id: "FLF_2008_0845210575_196ECM_N0911496FHAZ00206_01_295J", note: "La torreta del brazo sobre el suelo, con huellas de ruedas" },
    { id: "FLF_2011_0845477816_692ECM_N0920000FHAZ00215_04_075J", note: "El brazo posado sobre una roca" },
    { id: "FLF_2008_0845209498_020ECM_N0911496FHAZ02008_09_095J", note: "Una roca enorme, de cerca" },
    { id: "FLF_2011_0845475569_724ECM_N0920000FHAZ00203_19_295J", note: "El brazo, su sombra y una colina al fondo" },
    { id: "FLF_2008_0845208867_676ECM_N0911496FHAZ00206_01_295J", note: "La torreta del brazo y las huellas de las ruedas" },
    { id: "FLF_2009_0845299844_176ECM_N0920000FHAZ02008_07_095J", note: "La ladera hasta el horizonte, desde el frente del rover" },
    { id: "FLF_2011_0845478737_571ECM_N0920000FHAZ00206_01_295J", note: "El brazo en acción con una colina al fondo" },
    { id: "FLF_2008_0845209498_020ECM_N0911496FHAZ02008_10_095J", note: "Rocas y marcas de ruedas en la arena" },
  ],
  watson: [
    { id: "SIF_2011_0845480156_062EBY_N0920000SRLC01025_0000LMJ", note: "Un círculo en la roca, visto a centímetros" },
    { id: "SIF_2011_0845475020_042EBY_N0920000SRLC04003_0000LMJ", note: "La sombra de Percy sobre una roca" },
    { id: "SIF_2008_0845210698_800EBY_N0911496SRLC00354_0000LMJ", note: "Granos de roca anaranjados, a centímetros" },
    { id: "SIF_2011_0845479843_968EBY_N0920000SRLC02505_0000LMJ", note: "El círculo y la roca que lo rodea" },
    { id: "SIF_2011_0845475191_921EBY_N0920000SRLC00730_0000LMJ", note: "Arena anaranjada con ondulaciones" },
    { id: "SIF_2004_0844875419_140EBY_N0910970SRLC08065_0000LMJ", note: "Un guijarro blanco entre piedras" },
  ],
};
