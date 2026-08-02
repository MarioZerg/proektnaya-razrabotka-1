import { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Icon from '@/components/ui/icon';
import { readFileAsBase64 } from '@/components/crm/marketplaceSupplies/marketplaceSuppliesShared';

interface PassStickerCardProps {
  passStickerUrl: string | null;
  passStickerName: string | null;
  saving: boolean;
  onUpload: (base64: string, fileName: string) => void;
}

const PassStickerCard = ({ passStickerUrl, passStickerName, saving, onUpload }: PassStickerCardProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const base64 = await readFileAsBase64(file);
      onUpload(base64, file.name);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <Card className="border-border shadow-none">
      <CardHeader>
        <CardTitle className="text-base">Стикер пропуска (PDF)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {passStickerUrl ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2 overflow-hidden">
              <Icon name="FileText" size={18} className="shrink-0 text-muted-foreground" />
              <span className="truncate text-sm font-medium">{passStickerName || 'sticker.pdf'}</span>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={passStickerUrl} target="_blank" rel="noopener noreferrer">
                <Icon name="ExternalLink" size={14} className="mr-1.5" />
                Открыть
              </a>
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Стикер пропуска ещё не загружен</p>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleChange} />
        <Button
          variant="outline"
          size="sm"
          disabled={saving || uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <Icon name="Loader2" size={14} className="mr-1.5 animate-spin" />
          ) : (
            <Icon name="Upload" size={14} className="mr-1.5" />
          )}
          {passStickerUrl ? 'Заменить файл' : 'Загрузить PDF'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default PassStickerCard;
