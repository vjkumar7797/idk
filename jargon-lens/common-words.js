// Everyday English words that are never flagged as "hard". Anything not in here
// (after stripping simple suffixes) and at least 7 letters long counts as jargon.
window.JT_COMMON = new Set(`
about above across action actually after again against almost along already also always among another answer anyone anything
around asked away because become been before began behind being believe below best better between beyond both bring brought
build built business called came can cannot case cause certain change check child children choose clear close come common
company complete consider continue could country course create current cut data day days decide different does doing done
down during each early easy effect either else end enough even ever every example expect explain face fact family far feel
feeling feet few field figure find first follow following food for form found four free friend from full future game gave
general get getting give given going good got great group grow grew hand happen happened hard have having head hear heard
help here high history hold home hope hour house however human hundred idea important include information instead interest
into issue it its job just keep kind knew know known large last later learn least leave left less let level life light like
likely line list little live long look lost made make making man many matter may maybe mean means meet member might mind
minute moment money month more morning most mother move much must name near need never new next night nothing now number
off often old once only open order other others our out over own page paper part particular party pass past people perhaps
person place plan play point possible power present president problem process program provide public put question quite
rather reach read ready real really reason receive recent record remember report require result return right room run said
same saw say school second see seem seemed seen sense set several shall should show side simple since small social some
someone something sometimes soon sort sound space speak special stand start state stay step still stop story strong student
study such sure system take taken talk team tell than thank that the their them then there therefore these they thing things
think third this those though thought three through time times today together told too took top toward try turn two under
understand until upon use used using usually value very view voice wait walk want was watch water way week well went were
what when where whether which while white who whole whose why will with within without woman women word words work world
would write written wrong year years yes yet you young your
actual address allow amount analysis anyway application approach area available average basic benefit board body book
brand break bring budget buy call care carry cost couple cover credit culture customer detail develop direct discuss
doctor draw drive economy education energy environment event everyone evidence experience eye fall fast feature final
fire focus force further government health heart improve industry inside local machine main market material measure media
mention model movie music natural nature network normal note offer office option outside pattern performance picture
policy position pressure price product project property quality quick range rate reduce relate remain research resource
response rule safe save science section sell send series service share short similar single size skill software solution
source speed standard strategy structure style subject success support task technology term test thanks theory tool total
train training type user video wall whatever whenever whether
`.split(/\s+/).filter(Boolean));
